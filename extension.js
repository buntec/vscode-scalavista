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

const supportedScalaVersions = ['2.11', '2.12', '2.13']
let serverProcess = null
let errorRefreshIntervalObj = null
let checkServerIntervalObj = null
let startServerIntervalObj = null
let typeHoverDisposable = null
let kindHoverDisposable = null
let fqnHoverDisposable = null
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

function getWorkspaceRoot () {
  return vscode.workspace.workspaceFolders[0].uri.fsPath
}

const logFilePath = path.join(getWorkspaceRoot(), 'scalavista-vscode.log')
let logFile
try {
  logFile = fs.openSync(logFilePath, 'w')
} catch (err) {
  logFile = 'ignore'
}

function getRandomIntInclusive (min, max) {
  min = Math.ceil(min)
  max = Math.floor(max)
  return Math.floor(Math.random() * (max - min + 1)) + min // The maximum is inclusive and the minimum is inclusive
}

function startServer (javaCmd, serverJar, uuid, port, isDebug) {
  const options = {
    cwd: vscode.workspace.workspaceFolders[0].uri.fsPath,
    stdio: ['pipe', logFile, logFile]
  }
  const flags = ['-jar', serverJar, '--uuid', uuid, '--port', port.toString()]
  if (isDebug) {
    flags.push('--debug')
  }
  vscode.window.showInformationMessage(`Starting language server (port ${port}).`)
  return spawn(javaCmd, flags, options)
}

function serverJarIsOk (javaCmd, serverJar) {
  return new Promise(function (resolve, reject) {
    const options = { cwd: vscode.workspace.workspaceFolders[0].uri.fsPath }
    const subprocess = spawn(javaCmd, ['-jar', serverJar, '--help'], options)
    subprocess.stdout.on('data', (data) => {
      resolve(data)
    })
    subprocess.stderr.on('data', (data) => {
      reject(data)
    })
    subprocess.on('error', (err) => reject(err))
  })
}

function parseScalavistaJson () {
  const workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath
  const pathToFile = path.join(workspaceRoot, 'scalavista.json')
  if (fs.existsSync(pathToFile)) {
    return JSON.parse(fs.readFileSync(pathToFile))
  } else {
    vscode.window.showWarningMessage('scalavista.json not found - consider creating one for your project.')
    return {}
  }
}

function downloadFile (url, writePath) {
  return axios({
    method: 'get',
    url: url,
    responseType: 'stream'
  }).then(function (response) {
    const stream = fs.createWriteStream(writePath)
    response.data.pipe(stream)
    return vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Downloading ${url} to ${writePath}.`,
        cancellable: true
      },
      (progress, token) => {
        token.onCancellationRequested(() => {
          stream.destroy('user cancelled')
        })
        return new Promise(function (resolve, reject) {
          stream.on('finish', () => {
            vscode.window.showInformationMessage(`Completed download of ${url}.`)
            resolve()
          })
          stream.on('error', (err) => {
            vscode.window.showInformationMessage(`Download aborted: ${err}.`)
            reject(err)
          })
        })
      }
    )
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

function completionItemKindFromSymbolKind (kind) {
  switch (kind) {
    case 'method':
      return vscode.CompletionItemKind.Method
    case 'object':
      return vscode.CompletionItemKind.Module
    case 'class':
      return vscode.CompletionItemKind.Class
    case 'trait':
      return vscode.CompletionItemKind.Interface
    case 'value':
      return vscode.CompletionItemKind.Field
    default:
      return vscode.CompletionItemKind.Text
  }
}

function isJavaAvailable () {
  const javaCmd = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin', 'java') : 'java'
  return new Promise(function (resolve, reject) {
    const subprocess = spawn(javaCmd, ['-version'])
    subprocess.on('error', (err) => {
      reject(err)
    })
    subprocess.stdout.on('data', () => {
      resolve(javaCmd)
    })
    subprocess.stderr.on('data', () => {
      resolve(javaCmd)
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
      const text = response.data ? new vscode.MarkdownString('type:').appendCodeblock(response.data, 'scala') : ''
      return new vscode.Hover(text)
    })
  }
}

const kindHoverProvider = {
  provideHover (document, position) {
    const filename = document.fileName
    const fileContents = document.getText()
    const offset = document.offsetAt(position)
    const payload = {
      filename,
      fileContents,
      offset
    }
    return axios.post(serverUrl() + '/ask-kind-at', payload).then(response => {
      const text = response.data ? `kind: ${response.data}` : ''
      return new vscode.Hover(text)
    })
  }
}

const fullyQualifiedNameHoverProvider = {
  provideHover (document, position) {
    const filename = document.fileName
    const fileContents = document.getText()
    const offset = document.offsetAt(position)
    const payload = {
      filename,
      fileContents,
      offset
    }
    return axios.post(serverUrl() + '/ask-fully-qualified-name-at', payload).then(response => {
      const text = response.data ? new vscode.MarkdownString('fully qualified name:').appendCodeblock(response.data, 'scala') : ''
      return new vscode.Hover(text)
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
      const text = response.data ? new vscode.MarkdownString().appendCodeblock(response.data) : ''
      return new vscode.Hover(text)
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
        const kind = completionItemKindFromSymbolKind(comp[2])
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
        const kind = completionItemKindFromSymbolKind(comp[2])
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

  let scalaVersion
  let serverJar = null
  let serverIsAlive = false
  let tryToStartServer = false

  const refreshPeriod = vscode.workspace.getConfiguration('Scalavista').get('diagnosticsRefreshPeriod')
  const defaultScalaVersion = vscode.workspace.getConfiguration('Scalavista').get('defaultScalaVersion')
  const isDebugMode = vscode.workspace.getConfiguration('Scalavista').get('debugMode')

  function setScalaVersion () {
    const scalavistaJson = parseScalavistaJson()
    scalaVersion = R.has('scalaBinaryVersion', scalavistaJson)
      ? scalavistaJson.scalaBinaryVersion : defaultScalaVersion
    if (!R.contains(scalaVersion, supportedScalaVersions)) {
      vscode.window.showErrorMessage(`Scala version ${scalaVersion} is not valid/supported. Must be one of ${supportedScalaVersions}`)
    }
  }

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
          axios.get(serverUrl() + '/version')
            .then(response => {
              const version = response.data
              statusBarItem.text = `Scalavista server ${version} online (Scala ${scalaVersion}, port ${port})`
              statusBarItem.tooltip = `Serving at ${serverUrl()}`
            }).catch(() => {})
          setAlive(function () {
            vscode.window.showInformationMessage('Scala language server is now live.')
            reloadOpenDocuments()
          })
        } else {
          throw Error('uuids not matching - another instance of scalavista server seems to be running')
        }
      }).catch(() => {
        statusBarItem.text = 'Waiting for Scala language server to come alive...'
        statusBarItem.tooltip = ''
        setDead(() => {})
      })
  }

  function downloadLatestServerJar (scalaVersion) {
    return getLatestServerJarAsset(scalaVersion)
      .then((asset) => {
        const extensionRoot = getExtensionPath()
        const name = asset.name
        const filePath = path.join(extensionRoot, name)
        const downloadUrl = asset.browser_download_url
        return downloadFile(downloadUrl, filePath)
      })
  }

  function conditionallyDownloadServerJar (scalaVersion) {
    return getLatestServerJarAsset(scalaVersion)
      .then((asset) => {
        const extensionRoot = getExtensionPath()
        const name = asset.name
        const filePath = path.join(extensionRoot, name)
        const sizeInMb = asset.size / 1000000
        if (!fs.existsSync(filePath)) {
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
  }

  function getLatestServerJarAsset (scalaVersion) {
    return axios.get(serverReleasesUrl)
      .then(response => {
        const releases = response.data
        const assets = releases[0].assets
        return assets.filter(asset => {
          const name = asset.name
          return isValidServerJar(name) && (getScalaVersionFromServerJar(name) === scalaVersion)
        })[0]
      }).catch(() => {
        vscode.window.showWarningMessage(
                `Failed to query GitHub for the latest Scalavista server jars.
                No internet or behind a proxy?`
        )
      })
  }

  function killServer () {
    return new Promise((resolve) => {
      if (serverProcess !== null) {
        try {
          serverProcess.removeAllListeners('exit') // don't want to notify user when we deliberately shut down the server
          serverProcess.on('exit', () => {
            resolve()
          })
          serverProcess.stdin.end('x') // any input will shut down the server
        } catch (err) {
          resolve()
        }
      } else {
        resolve()
      }
    })
  }

  function conditionallyStartServer () {
    if ((serverJar !== null) && tryToStartServer && !serverIsAlive) {
      tryToStartServer = false
      if (serverProcess !== null) {
        try {
          serverProcess.stdin.end('x') // any input will shut down the server
        } catch (err) { }
      }
      isJavaAvailable()
        .then(javaCmd => {
          serverJarIsOk(javaCmd, serverJar)
            .then(() => {
              port = getRandomIntInclusive(portMin, portMax)
              serverProcess = startServer(javaCmd, serverJar, uuid, port, isDebugMode)
              serverProcess.on('exit', () => {
                return vscode.window.showErrorMessage('Language server process exited.', 'Restart', 'Show logs', 'Dismiss').then(
                  (answer) => {
                    if (answer === 'Restart') {
                      tryToStartServer = true
                    } else if (answer === 'Show logs') {
                      return vscode.window.showTextDocument(vscode.Uri.file(logFilePath))
                    }
                  }
                )
              })
              serverProcess.on('error', () => {
                return vscode.window.showErrorMessage('Error when spawning server process', 'Show log')
              })
            }).catch((err) => {
              return vscode.window.showErrorMessage(`${err}`, 'Download latest jar from GitHub').then((answer) => {
                if (answer) {
                  return downloadLatestServerJar(scalaVersion).then(() => {
                    tryToStartServer = true
                  })
                }
              })
            })
        }).catch(() => {})
    }
  }

  function serverInit () {
    setScalaVersion()
    tryToStartServer = false
    killServer().then(() => isJavaAvailable()).catch(() => {
      vscode.window.showWarningMessage('Unable to find java - make sure it is on your PATH or JAVA_HOME is defined.')
    }
    ).then(() => {
      return conditionallyDownloadServerJar(scalaVersion)
    }).catch(() => {})
      .finally(() => {
        const serverJarsByScalaVersion = locateServerJars()
        serverJar = R.has(scalaVersion, serverJarsByScalaVersion) ? serverJarsByScalaVersion[scalaVersion] : null
        if (serverJar) {
          tryToStartServer = true
          conditionallyStartServer()
        } else {
          vscode.window.showWarningMessage(`No server jar found for Scala version ${scalaVersion}`)
        }
      })
  }

  serverInit()

  const configWatcher = vscode.workspace.createFileSystemWatcher('**/scalavista.json')
  configWatcher.onDidChange(function () {
    vscode.window.showInformationMessage('scalavista.json change detected - restarting language server.')
    serverInit()
  })

  // The command has been defined in the package.json file
  // Now provide the implementation of the command with  registerCommand
  // The commandId parameter must match the command field in package.json
  const disposable = vscode.commands.registerCommand('extension.restartServer', function () {
    killServer().then(() => {
      tryToStartServer = true
    })
  })

  const diagnosticCollection = vscode.languages.createDiagnosticCollection('scalavista')

  definitionProviderDisposable = vscode.languages.registerDefinitionProvider('scala', definitionProvider)

  typeHoverDisposable = vscode.languages.registerHoverProvider('scala', typeHoverProvider)

  kindHoverDisposable = vscode.languages.registerHoverProvider('scala', kindHoverProvider)

  fqnHoverDisposable = vscode.languages.registerHoverProvider('scala', fullyQualifiedNameHoverProvider)

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
  kindHoverDisposable.dispose()
  fqnHoverDisposable.dispose()
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
