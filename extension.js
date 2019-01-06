// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
const vscode = require('vscode');
const axios = require('axios')

let errorRefreshIntervalObj = null
let typeHoverDisposable = null
let docHoverDisposable = null
let typeCompletionDisposable = null
let scopeCompletionDisposable = null
let definitionProviderDisposable = null
let port = 0
let notes = null

function completionKindFromDetail(detail) {
	const isDef = /\bdef\b/.test(detail)
	const isVal = /\bval\b/.test(detail)
	const isClass = /\b(class|object)\b/.test(detail)
	return isDef ? vscode.CompletionItemKind.Method :
		isVal ? vscode.CompletionItemKind.Field :
		isClass ? vscode.CompletionItemKind.Class :
		vscode.CompletionItemKind.Text
}

function serverUrl() {
	return 'http://localhost:' + port
}

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {

	port = vscode.workspace.getConfiguration('Scalavista').get('port')
	const refreshPeriod = vscode.workspace.getConfiguration('Scalavista').get('diagnosticsRefreshPeriod')

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	//console.log('Congratulations, your extension "vscode-scalavista" is now active!');

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with  registerCommand
	// The commandId parameter must match the command field in package.json
	let disposable = vscode.commands.registerCommand('extension.scalavistaDebugDump', function () {
		// The code you place here will be executed every time your command is executed

		// Display a message box to the user
		//vscode.window.showInformationMessage('Hello World!');
		axios.post(serverUrl() + '/log-debug', {})
	});

	const diagnosticCollection = vscode.languages.createDiagnosticCollection("scalavista")


	const definitionProvider = {
		provideDefinition(document, position) {

			let filename = document.fileName
			let fileContents = document.getText()
			let offset = document.offsetAt(position)
			let payload = {
				filename,
				fileContents,
				offset
			}
			return axios.post(serverUrl() + '/ask-pos-at', payload).then(response => {
				let file = response.data.file
				if (file == '<no source file>')
					return null
				let uri = vscode.Uri.file(file)
				let line = parseInt(response.data.line) - 1
				let column = parseInt(response.data.column) - 1
				let pos = new vscode.Position(line, column)
				//let pos = document.positionAt(parseInt(response.data.pos))
				return new vscode.Location(uri, pos)
			})

		}
	}

	definitionProviderDisposable = vscode.languages.registerDefinitionProvider('scala', definitionProvider)

	const typeHoverProvider = {
		provideHover(document, position) {
			let filename = document.fileName
			let fileContents = document.getText()
			let offset = document.offsetAt(position)
			let payload = {
				filename,
				fileContents,
				offset
			}
			return axios.post(serverUrl() + '/ask-type-at', payload).then(response => {
				return new vscode.Hover(response.data)
			})
		}
	}

	typeHoverDisposable = vscode.languages.registerHoverProvider('scala', typeHoverProvider)

	const docHoverProvider = {
		provideHover(doc, pos) {
			let filename = doc.fileName
			let fileContents = doc.getText()
			let offset = doc.offsetAt(pos)
			let payload = {
				filename,
				fileContents,
				offset
			}
			return axios.post(serverUrl() + '/ask-doc-at', payload).then(response => {
				return new vscode.Hover(response.data)
			})
		}
	}

	docHoverDisposable = vscode.languages.registerHoverProvider('scala', docHoverProvider)

	const typeCompletionProvider = {

		provideCompletionItems(document, position) {
			let filename = document.fileName
			let fileContents = document.getText()
			let offset = document.offsetAt(position)
			let payload = {
				filename,
				fileContents,
				offset
			}
			return axios.post(serverUrl() + '/type-completion', payload).then(response => {
				let completionItems = response.data.map(comp => {
					const label = comp[0]
					const detail = comp[1]
					const kind = completionKindFromDetail(detail)
					const item = new vscode.CompletionItem(label, kind)
					item.detail = detail
					return item
				})
				return new vscode.CompletionList(completionItems, true)
			})
		}
	}

	typeCompletionDisposable = vscode.languages.registerCompletionItemProvider('scala', typeCompletionProvider, ".")

	const scopeCompletionProvider = {

		provideCompletionItems(document, position) {
			let filename = document.fileName
			let fileContents = document.getText()
			let offset = document.offsetAt(position)
			let payload = {
				filename,
				fileContents,
				offset
			}
			return axios.post(serverUrl() + '/scope-completion', payload).then(response => {
				let completionItems = response.data.map(comp => {
					let label = comp[0]
					let detail = comp[1]
					let kind = completionKindFromDetail(detail)
					let item = new vscode.CompletionItem(label, kind)
					item.detail = detail
					return item
				})
				return new vscode.CompletionList(completionItems, true)
			})
		}
	}

	scopeCompletionDisposable = vscode.languages.registerCompletionItemProvider('scala', scopeCompletionProvider)

	errorRefreshIntervalObj = setInterval(getErrorsAndUpdateDiagnostics, refreshPeriod)

	function getErrorsAndUpdateDiagnostics() {

		return axios.get(serverUrl() + '/errors').then(response => {
			if (JSON.stringify(response.data) === JSON.stringify(notes)) {
				return // skip if errors don't change
			}
			notes = response.data
			diagnosticCollection.clear()
			vscode.workspace.textDocuments.filter(doc => doc.languageId == 'scala').forEach(doc => {
				let uri = doc.uri
				let filepath = uri.fsPath
				let diagnostics = notes.filter(note => note[0].toLowerCase() == filepath.toLowerCase())
					.map(note => {
						let start = note[3]
						let end = note[4]
						let message = note[5]
						let kind = note[6]
						let posStart = doc.positionAt(start)
						let posEnd = doc.positionAt(end)
						let range = new vscode.Range(posStart, posEnd)
						let severity = vscode.DiagnosticSeverity.Hint
						switch (kind) {
							case 'ERROR':
								severity = vscode.DiagnosticSeverity.Error
								break;
							case 'WARNING':
								severity = vscode.DiagnosticSeverity.Warning
								break;
							case 'WARN':
								severity = vscode.DiagnosticSeverity.Warning
								break;
							case 'INFO':
								severity = vscode.DiagnosticSeverity.Information
								break;
						}
						return new vscode.Diagnostic(range, message, severity)
					})
				diagnosticCollection.set(uri, diagnostics)
			})
		}).catch(() => {})
	}

	vscode.workspace.onDidChangeTextDocument(event => {
		if (event.document.languageId != 'scala')
			return
		let filename = event.document.fileName
		let fileContents = event.document.getText()
		let payload = {
			filename,
			fileContents
		}
		axios.post(serverUrl() + '/reload-file', payload)
	})

	context.subscriptions.push(disposable);
}
exports.activate = activate;

// this method is called when your extension is deactivated
function deactivate() {
	typeHoverDisposable.dispose()
	docHoverDisposable.dispose()
	typeCompletionDisposable.dispose()
	scopeCompletionDisposable.dispose()
	definitionProviderDisposable.dispose()
	clearInterval(errorRefreshIntervalObj)
}

module.exports = {
	activate,
	deactivate
}