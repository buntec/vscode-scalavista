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

let serverProcess = null
let errorRefreshIntervalObj = null
let checkServerIntervalObj = null
let startServerIntervalObj = null
let typeHoverDisposable = null
let docHoverDisposable = null
let typeCompletionDisposable = null
let scopeCompletionDisposable = null
let definitionProviderDisposable = null
let notes = null
let statusBarItem = null
const serverReleasesUrl = 'https://api.github.com/repos/buntec/scalavista-server/releases'
const portMin = 49152
const portMax = 65535
let port = portMin

function getExtensionPath () {
  return vscode.extensions.getExtension('buntec.vscode-scalavista').extensionPath
}

let outLogFile
try {
  outLogFile = fs.openSync(path.join(getExtensionPath(), 'scalavista-err.log'), 'w')
} catch (err) {
  outLogFile = 'ignore'
}

let errLogFile
try {
  errLogFile = fs.openSync(path.join(getExtensionPath(), 'scalavista-out.log'), 'w')
} catch (err) {
  errLogFile = 'ignore'
}

function getRandomIntInclusive (min, max) {
  min = Math.ceil(min)
  max = Math.floor(max)
  return Math.floor(Math.random() * (max - min + 1)) + min // The maximum is inclusive and the minimum is inclusive
}

function startServer (serverJar, uuid, port) {
  const options = {
    cwd: vscode.workspace.workspaceFolders[0].uri.fsPath,
    stdio: ['pipe', outLogFile, errLogFile]
  }
  vscode.window.showInformationMessage(`Starting scalavista server (port ${port}).`)
  return spawn('java', ['-jar', serverJar, '--uuid', uuid, '--port', port.toString()], options)
}

function parseScalavistaJson () {
  const workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath
  const pathToFile = path.join(workspaceRoot, 'scalavista.json')
  if (fs.existsSync(pathToFile)) {
    return JSON.parse(fs.readFileSync(pathToFile))
  } else {
    vscode.window.showWarningMessage(`scalavista.json not found - consider generating one for your 
    project using the scalavista sbt plugin. External dependencies will otherwise not be recognized.`)
    return {}
  }
}

function downloadFile (url, writePath) {
  vscode.window.showInformationMessage(`Attempting to download ${url} to ${writePath}.`)
  return axios({
    method: 'get',
    url: url,
    responseType: 'stream'
  }).then(function (response) {
    const stream = fs.createWriteStream(writePath)
    response.data.pipe(stream)
    return new Promise(function (resolve, reject) {
      stream.on('finish', () => {
        vscode.window.showInformationMessage(`Completed download of ${url}.`)
        resolve()
      })
      stream.on('error', (err) => {
        reject(err)
      })
    })
  }).catch(() => {
    vscode.window.showWarningMessage(`Failed to download ${url}.`)
  })
}

function isValidServerJar (jar) {
  return /scalavista-server-.*\.jar/.test(jar) && /\d+\.\d+\.\d+/.test(jar) && /_(\d\.\d{1,2})\.jar/.test(jar)
}

function getScalaVersionFromServerJar (jar) {
  if (isValidServerJar(jar)) {
    return jar.match(/_(\d\.\d{1,2})\.jar/)[1]
  } else {
    return null
  }
}

function getScalavistaVersionFromServerJar (jar) {
  if (isValidServerJar(jar)) {
    return jar.match(/\d+\.\d+\.\d+/)[0]
  } else {
    return null
  }
}

function locateServerJars () {
  const serverJars = []
  const extensionRoot = getExtensionPath()
  const items = fs.readdirSync(extensionRoot)
  items.forEach(item => {
    if (isValidServerJar(item)) {
      serverJars.push(path.join(extensionRoot, item))
    }
  })
  if (R.isEmpty(serverJars)) {
    return {}
  }
  const serverJarsByVersion = R.groupBy(getScalavistaVersionFromServerJar, serverJars)
  const versions = R.keys(serverJarsByVersion)
  const latestVersion = versions.sort(semver.rcompare)[0]
  const latestJars = serverJarsByVersion[latestVersion]
  const latestJarsByScalaVersion = R.map(a => a[0], R.groupBy(getScalaVersionFromServerJar, latestJars))
  return latestJarsByScalaVersion
}

// (re)load all Scala/Java docs that are already open
function reloadOpenDocuments () {
  vscode.workspace.textDocuments.forEach(document => {
    if ((document.languageId !== 'scala') && (document.languageId !== 'java')) {
      return
    }
    const filename = document.fileName
    const fileContents = document.getText()
    const payload = {
      filename,
      fileContents
    }
    axios.post(serverUrl() + '/reload-file', payload)
  })
}

function completionKindFromDetail (detail) {
  const isDef = /\bdef\b/.test(detail)
  const isVal = /\bval\b/.test(detail)
  const isClass = /\b(class|object)\b/.test(detail)
  return isDef ? vscode.CompletionItemKind.Method
    : isVal ? vscode.CompletionItemKind.Field
      : isClass ? vscode.CompletionItemKind.Class
        : vscode.CompletionItemKind.Text
}

function isJavaAvailable () {
  return new Promise(function (resolve, reject) {
    const subprocess = spawn('java', ['-version'])
    subprocess.on('error', () => {
      resolve(false)
    })
    subprocess.stdout.on('data', () => {
      resolve(true)
    })
    subprocess.stderr.on('data', () => {
      resolve(true)
    })
  })
}

function serverUrl () {
  return 'http://localhost:' + port
}

const definitionProvider = {
  provideDefinition (document, position) {
    const filename = document.fileName
    const fileContents = document.getText()
    const offset = document.offsetAt(position)
    const payload = {
      filename,
      fileContents,
      offset
    }
    return axios.post(serverUrl() + '/ask-pos-at', payload).then(response => {
      const file = response.data.file
      if (file === '<no source file>') {
        return null
      }
      const uri = vscode.Uri.file(file)
      const line = parseInt(response.data.line) - 1
      const column = parseInt(response.data.column) - 1
      const pos = new vscode.Position(line, column)
      // let pos = document.positionAt(parseInt(response.data.pos))
      return new vscode.Location(uri, pos)
    })
  }
}

const typeHoverProvider = {
  provideHover (document, position) {
    const filename = document.fileName
    const fileContents = document.getText()
    const offset = document.offsetAt(position)
    const payload = {
      filename,
      fileContents,
      offset
    }
    return axios.post(serverUrl() + '/ask-type-at', payload).then(response => {
      return new vscode.Hover(response.data)
    })
  }
}

const docHoverProvider = {
  provideHover (doc, pos) {
    const filename = doc.fileName
    const fileContents = doc.getText()
    const offset = doc.offsetAt(pos)
    const payload = {
      filename,
      fileContents,
      offset
    }
    return axios.post(serverUrl() + '/ask-doc-at', payload).then(response => {
      return new vscode.Hover(response.data)
    })
  }
}

const typeCompletionProvider = {

  provideCompletionItems (document, position) {
    const filename = document.fileName
    const fileContents = document.getText()
    const offset = document.offsetAt(position)
    const payload = {
      filename,
      fileContents,
      offset
    }
    return axios.post(serverUrl() + '/type-completion', payload).then(response => {
      const completionItems = response.data.map(comp => {
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

const scopeCompletionProvider = {

  provideCompletionItems (document, position) {
    const filename = document.fileName
    const fileContents = document.getText()
    const offset = document.offsetAt(position)
    const payload = {
      filename,
      fileContents,
      offset
    }
    return axios.post(serverUrl() + '/scope-completion', payload).then(response => {
      const completionItems = response.data.map(comp => {
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

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed

/**
 * @param {vscode.ExtensionContext} context
 */
function activate (context) {
  const uuid = uuidv4()

  let serverJar = null
  let serverIsAlive = false
  let tryToStartServer = false

  const refreshPeriod = vscode.workspace.getConfiguration('Scalavista').get('diagnosticsRefreshPeriod')
  const defaultScalaVersion = vscode.workspace.getConfiguration('Scalavista').get('defaultScalaVersion')

  const scalavistaJson = parseScalavistaJson()
  const scalaVersion = R.has('scalaBinaryVersion', scalavistaJson)
    ? scalavistaJson.scalaBinaryVersion : defaultScalaVersion

  function setAlive (callback) {
    if (!serverIsAlive) {
      serverIsAlive = true
      callback()
    }
  }

  function setDead (callback) {
    if (serverIsAlive) {
      serverIsAlive = false
      callback()
    }
  }

  function checkServerAlive (scalaVersion, uuid) {
    axios.get(serverUrl() + '/alive')
      .then(response => {
        if (response.data === uuid) {
          statusBarItem.text = `Scalavista server online (Scala ${scalaVersion}, port ${port})`
          statusBarItem.tooltip = `Serving at ${serverUrl()}`
          setAlive(reloadOpenDocuments)
        } else {
          throw Error('uuids not matching - another instance of scalavista server seems to be running')
        }
      }).catch(() => {
        statusBarItem.text = 'Waiting for Scalavista server to come alive...'
        statusBarItem.tooltip = ''
        setDead(() => {})
      })
  }

  function conditionallyDownloadServerJar (scalaVersion) {
    const extensionRoot = getExtensionPath()
    return axios.get(serverReleasesUrl)
      .then(response => {
        const releases = response.data
        const assets = releases[0].assets
        const promises = assets.map(asset => {
          const name = asset.name
          const filePath = path.join(extensionRoot, name)
          if (isValidServerJar(name) && (getScalaVersionFromServerJar(name) === scalaVersion) && !fs.existsSync(filePath)) {
            const sizeInMb = asset.size / 1000000
            return vscode.window.showInformationMessage(
              `New Scalavista server jar found ${name}. Download from GitHub? (~ ${sizeInMb.toFixed(2)} MB)`, 'Yes', 'No'
            ).then(answer => {
              if (answer === 'Yes') {
                const downloadUrl = asset.browser_download_url
                return downloadFile(downloadUrl, filePath)
              }
            }).catch(() => {})
          }
        })
        return Promise.all(promises)
      }).catch(() => {
        vscode.window.showWarningMessage(
            `Failed to query GitHub for the latest Scalavista server jars.
             No internet or behind a proxy?`
        )
      })
  }

  function conditionallyStartServer () {
    if ((serverJar !== null) && tryToStartServer && !serverIsAlive) {
      tryToStartServer = false
      if (serverProcess !== null) {
        try {
          serverProcess.stdin.write('x') // any input will shut down the server
          serverProcess.stdin.end()
        } catch (err) { }
      }
      port = getRandomIntInclusive(portMin, portMax)
      serverProcess = startServer(serverJar, uuid, port)
      serverProcess.on('exit', () => {
        tryToStartServer = true
        vscode.window.showWarningMessage('Scalavista server process exited. Will try to restart...')
      })
      serverProcess.on('error', () => {
        tryToStartServer = true
        vscode.window.showWarningMessage('Error when spawing scalavista server process. Will try to restart...')
      })
    }
  }

  isJavaAvailable().then(hasJava => {
    if (hasJava) {
      return conditionallyDownloadServerJar(scalaVersion).then(() => { tryToStartServer = true })
    } else {
      tryToStartServer = false
      vscode.window.showWarningMessage('Unable to find java executable - make sure it is on your PATH. Java is required to run the language server.')
    }
  }).finally(() => {
    const serverJarsByScalaVersion = locateServerJars()
    serverJar = R.has(scalaVersion, serverJarsByScalaVersion) ? serverJarsByScalaVersion[scalaVersion] : null
    conditionallyStartServer()
  })

  // The command has been defined in the package.json file
  // Now provide the implementation of the command with  registerCommand
  // The commandId parameter must match the command field in package.json
  const disposable = vscode.commands.registerCommand('extension.scalavistaDebugDump', function () {
    axios.post(serverUrl() + '/log-debug', {})
  })

  const diagnosticCollection = vscode.languages.createDiagnosticCollection('scalavista')

  definitionProviderDisposable = vscode.languages.registerDefinitionProvider('scala', definitionProvider)

  typeHoverDisposable = vscode.languages.registerHoverProvider('scala', typeHoverProvider)

  docHoverDisposable = vscode.languages.registerHoverProvider('scala', docHoverProvider)

  typeCompletionDisposable = vscode.languages.registerCompletionItemProvider('scala', typeCompletionProvider, '.')

  scopeCompletionDisposable = vscode.languages.registerCompletionItemProvider('scala', scopeCompletionProvider)

  statusBarItem = vscode.window.createStatusBarItem()
  statusBarItem.text = 'Scalavista extension activated'
  statusBarItem.show()

  startServerIntervalObj = setInterval(conditionallyStartServer, 1000)
  checkServerIntervalObj = setInterval(() => checkServerAlive(scalaVersion, uuid), 500)
  errorRefreshIntervalObj = setInterval(getErrorsAndUpdateDiagnostics, refreshPeriod)

  function getErrorsAndUpdateDiagnostics () {
    return axios.get(serverUrl() + '/errors').then(response => {
      if (JSON.stringify(response.data) === JSON.stringify(notes)) {
        return // skip if errors don't change
      }
      notes = response.data
      diagnosticCollection.clear()
      vscode.workspace.textDocuments.filter(doc => (doc.languageId === 'scala') || (doc.languageId === 'java'))
        .forEach(doc => {
          const uri = doc.uri
          const filepath = uri.fsPath
          const diagnostics = notes.filter(note => note[0].toLowerCase() === filepath.toLowerCase())
            .map(note => {
              const start = note[3]
              const end = note[4]
              const message = note[5]
              const kind = note[6]
              const posStart = doc.positionAt(start)
              const posEnd = doc.positionAt(end)
              const range = new vscode.Range(posStart, posEnd)
              let severity = vscode.DiagnosticSeverity.Hint
              switch (kind) {
                case 'ERROR':
                  severity = vscode.DiagnosticSeverity.Error
                  break
                case 'WARNING':
                  severity = vscode.DiagnosticSeverity.Warning
                  break
                case 'WARN':
                  severity = vscode.DiagnosticSeverity.Warning
                  break
                case 'INFO':
                  severity = vscode.DiagnosticSeverity.Information
                  break
              }
              return new vscode.Diagnostic(range, message, severity)
            })
          diagnosticCollection.set(uri, diagnostics)
        })
    }).catch(() => { })
  }

  vscode.workspace.onDidChangeTextDocument(event => {
    if ((event.document.languageId !== 'scala') && (event.document.languageId !== 'java')) {
      return
    }
    const filename = event.document.fileName
    const fileContents = event.document.getText()
    const payload = {
      filename,
      fileContents
    }
    axios.post(serverUrl() + '/reload-file', payload)
  })

  context.subscriptions.push(disposable)
}
exports.activate = activate

// this method is called when your extension is deactivated
function deactivate () {
  typeHoverDisposable.dispose()
  docHoverDisposable.dispose()
  typeCompletionDisposable.dispose()
  scopeCompletionDisposable.dispose()
  definitionProviderDisposable.dispose()
  clearInterval(errorRefreshIntervalObj)
  clearInterval(checkServerIntervalObj)
  clearInterval(startServerIntervalObj)
  statusBarItem.dispose()
  if (serverProcess !== null) {
    try {
      serverProcess.stdin.write('x') // any input will stop the server
      serverProcess.stdin.end()
    } catch (err) {}
  }
}

module.exports = {
  activate,
  deactivate
}
