// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
const vscode = require('vscode')
const axios = require('axios')
const fs = require('fs')
const path = require('path')
const {
	spawn
} = require('child_process')
const R = require('ramda')
const semver = require('semver')
const uuidv4 = require('uuid/v4')



let errorRefreshIntervalObj = null
let checkServerIntervalObj = null
let startServerIntervalObj = null
let typeHoverDisposable = null
let docHoverDisposable = null
let typeCompletionDisposable = null
let scopeCompletionDisposable = null
let definitionProviderDisposable = null
let port = 9317
let notes = null
let statusBarItem = null
let serverAlive = false
const serverReleasesUrl = 'https://api.github.com/repos/buntec/scalavista-server/releases'


function startServer(serverJar, uuid, port) {
	vscode.window.showInformationMessage(`attempting to start scalavista server on port ${port}`)
	return spawn('java', ['-jar', serverJar, '--uuid', uuid, '--port', port.toString()])
}

function parseScalavistaJson() {
	let workspaceRoot = vscode.workspace.workspaceFolders[0].uri.path
	let pathToFile = path.join(workspaceRoot, 'scalavista.json')
	if (fs.existsSync(pathToFile)) {
		return JSON.parse(fs.readFileSync(pathToFile))
	} else {
		return {}
	}
}

function downloadFile(url, writePath) {
	vscode.window.showInformationMessage(`Attempting to download ${url} to ${writePath}.`);
	axios({
		method: "get",
		url: url,
		responseType: "stream"
	}).then(function (response) {
		response.data.pipe(fs.createWriteStream(writePath));
		vscode.window.showInformationMessage(`Download of ${url} completed.`);
	}).catch(() => {
		vscode.window.showWarningMessage(`Failed to download ${url}.`)
	});
}

function getExtensionPath() {
	return vscode.extensions.getExtension("buntec.vscode-scalavista").extensionPath;
}

function conditionallyDownloadServerJar(scalaVersion) {
	let extensionRoot = getExtensionPath()
	axios.get(serverReleasesUrl).
	then(response => {
		let releases = response.data
		let assets = releases[0]['assets']
		assets.forEach(asset => {
			let name = asset['name']
			const filePath = path.join(extensionRoot, name)
			if (isValidServerJar(name) && (getScalaVersionFromServerJar(name) === scalaVersion) && !fs.existsSync(filePath)) {
				let sizeInMb = asset['size'] / 1000000
				vscode.window.showInformationMessage(`New Scalavista server jar found ${name} 
				   - OK to download from GitHub? (~ ${sizeInMb} MB)`, 'Yes', 'No').
				then(answer => {
					if (answer === 'Yes') {
						let downloadUrl = asset['browser_download_url']
						downloadFile(downloadUrl, filePath)
					}
				}).catch(() => {})
			}
		})
	}).catch(() => {
		vscode.window.showWarningMessage('Failed to query GitHub for the latest Scalavista server jars.')
	})
}

function isValidServerJar(jar) {
	return /scalavista-server-.*\.jar/.test(jar) &&
		/\d+\.\d+\.\d+/.test(jar) &&
		/\_(\d\.\d{1,2})\.jar/.test(jar)
}

function getScalaVersionFromServerJar(jar) {
	if (isValidServerJar(jar)) {
		return jar.match(/\_(\d\.\d{1,2})\.jar/)[1]
	} else {
		return null
	}
}

function getScalavistaVersionFromServerJar(jar) {
	if (isValidServerJar(jar)) {
		return jar.match(/\d+\.\d+\.\d+/)[0]
	} else {
		return null
	}
}

function locateServerJars() {
	let serverJars = []
	let extensionRoot = getExtensionPath()
	let items = fs.readdirSync(extensionRoot)
	items.forEach(item => {
		if (isValidServerJar(item)) {
			serverJars.push(path.join(extensionRoot, item))
		}
	})
	if (R.isEmpty(serverJars)) {
		return {}
	}
	let serverJarsByVersion = R.groupBy(getScalavistaVersionFromServerJar, serverJars)
	let versions = R.keys(serverJarsByVersion)
	let latestVersion = versions.sort(semver.rcompare)[0]
	let latestJars = serverJarsByVersion[latestVersion]
	let latestJarsByScalaVersion = R.map(a => a[0], R.groupBy(getScalaVersionFromServerJar, latestJars))
	return latestJarsByScalaVersion
}

function setAlive(callback) {
	if (!serverAlive) {
		serverAlive = true
		callback()
	}
}

function setDead(callback) {
	if (serverAlive) {
		serverAlive = false
		callback()
	}
}

// (re)load all Scala/Java docs that are already open
function reloadOpenDocuments() {
	vscode.workspace.textDocuments.forEach(document => {
		if ((document.languageId != 'scala') && (document.languageId != 'java'))
			return
		let filename = document.fileName
		let fileContents = document.getText()
		let payload = {
			filename,
			fileContents
		}
		axios.post(serverUrl() + '/reload-file', payload)
	})
}

/*
function serverIsOutdated(version) {
	try {
		let [major, minor, patch] = version.split('.').map(s => parseInt(s))
		let [majorLatest, minorLatest, patchLatest] = latestServerVersion.split('.').map(s => parseInt(s))
		if (majorLatest > major)
			return true
		if ((majorLatest == major) && (minorLatest > minor))
			return true
		if ((majorLatest == major) && (minorLatest == minor) && (patchLatest > patch))
			return true
	} catch (error) {}
	return false
}
*/

/*
function checkForLatestServerVersion() {
	axios.get('https://api.github.com/repos/buntec/scalavista-server/releases').then(response => {
		let releases = response.data
		let latestRelease = releases[0]['tag_name']
		latestServerVersion = latestRelease.substring(1)
	}).catch(() => {})
}
*/

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

	const uuid = uuidv4()
	const scalavistaJson = parseScalavistaJson()
	//checkForLatestServerVersion()

	port = vscode.workspace.getConfiguration('Scalavista').get('port')
	const refreshPeriod = vscode.workspace.getConfiguration('Scalavista').get('diagnosticsRefreshPeriod')
	//const showServerWarning = vscode.workspace.getConfiguration('Scalavista').get('showServerWarning')
	const defaultScalaVersion = vscode.workspace.getConfiguration('Scalavista').get('defaultScalaVersion')

	const scalaVersion = R.has('scalaBinaryVersion', scalavistaJson) ?
		scalavistaJson['scalaBinaryVersion'] : defaultScalaVersion

	conditionallyDownloadServerJar(scalaVersion)


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

	statusBarItem = vscode.window.createStatusBarItem()
	statusBarItem.text = "Scalavista extension activated"
	statusBarItem.show()

	function conditionallyStartServer() {
		if (!serverAlive) {
			let serverJarsByScalaVersion = locateServerJars()
			if (R.has(scalaVersion, serverJarsByScalaVersion)) {
				let serverJar = serverJarsByScalaVersion[scalaVersion]
				port += 1
				let serverProcess = startServer(serverJar, uuid, port)
				serverProcess.stdout.on('data', (data) => {
					console.log(data.toString())
				})
				serverProcess.stderr.on('data', (data) => {
					console.log(data.toString())
				})
				serverProcess.on('exit', () => {
					vscode.window.showWarningMessage('Scalavista server process exited.')
				})
				serverProcess.on('error', () => {
					vscode.window.showWarningMessage('Error when spawing scalavista server process.')
				})
			} else {
				vscode.window.showWarningMessage(`Unable to start server - no server jar found for Scala version ${scalaVersion}.`)
			}
		}
	}

	function checkServerAlive() {
		axios.get(serverUrl() + '/alive').
		then(response => {
			if (response.data === uuid) {
				statusBarItem.text = `Scalavista server online (Scala version ${scalaVersion})`
				statusBarItem.tooltip = `Serving at ${serverUrl()}`
				setAlive(reloadOpenDocuments)
			} else {
				throw 'uuids not matching - another instance of scalavista server seems to be running'
			}
		}).catch(() => {
			statusBarItem.text = 'Waiting for Scalavista server to come alive...'
			statusBarItem.tooltip = ''
			setDead()
		})
	}

	/*
	function checkServerAlive() {
		axios.get(serverUrl() + '/version')
			.then(response => {
				let serverVersion = response.data
				if (serverIsOutdated(serverVersion)) {
					statusBarItem.text = `Your version of scalavista-server (${serverVersion}) is outdated - please update to ${latestServerVersion}.`
					statusBarItem.tooltip = `Download the most recent version here: ${releaseUrl}`
				} else {
					statusBarItem.text = `Scalavista server ${serverVersion} live @ ${serverUrl()}`
					statusBarItem.tooltip = ''
					setAlive(reloadOpenDocuments)
				}
			})
			.catch(() => axios.get(serverUrl() + '/alive')
				.then(() => {
					statusBarItem.text = `Your version of scalavista-server is outdated - please update.`
					statusBarItem.tooltip = `Download the most recent version here: ${releaseUrl}`
				})
				.catch(() => {
					statusBarItem.text = 'Scalavista server appears down...'
					statusBarItem.tooltip = ''
					setDead()
				}))
	}
	*/

	checkServerAlive()
	conditionallyStartServer()
	startServerIntervalObj = setInterval(conditionallyStartServer, 5000)
	checkServerIntervalObj = setInterval(checkServerAlive, 250)
	errorRefreshIntervalObj = setInterval(getErrorsAndUpdateDiagnostics, refreshPeriod)

	function getErrorsAndUpdateDiagnostics() {

		return axios.get(serverUrl() + '/errors').then(response => {
			if (JSON.stringify(response.data) === JSON.stringify(notes)) {
				return // skip if errors don't change
			}
			notes = response.data
			diagnosticCollection.clear()
			vscode.workspace.textDocuments.filter(doc => (doc.languageId == 'scala') || (doc.languageId == 'java'))
				.forEach(doc => {
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
		if ((event.document.languageId != 'scala') && (event.document.languageId != 'java'))
			return
		let filename = event.document.fileName
		let fileContents = event.document.getText()
		let payload = {
			filename,
			fileContents
		}
		axios.post(serverUrl() + '/reload-file', payload)
	})

	/*
	if (showServerWarning) {
		setTimeout(() => {
			if (!serverAlive) {
				vscode.window.showWarningMessage(`You don't seem to be running a scalavista-server instance. 
			Download the latest version from [GitHub](${releaseUrl}).`)
			}
		}, 3000)
	}
	*/

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
	clearInterval(checkServerIntervalObj)
	clearInterval(startServerIntervalObj)
	statusBarItem.dispose()
}

module.exports = {
	activate,
	deactivate
}