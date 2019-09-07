# vscode-scalavista

![](demo2.gif)

A Visual Studio Code extension that provides IDE-like functionality
for the Scala language (2.11-2.13):

* show type on hover;
* show Scaladoc on hover;
* auto-completion;
* jump to definition (within the project);
* linting (compiler errors/warnings show up as you type).

The extension is a front-end to the [scalavista-server](https://github.com/buntec/scalavista-server)
language server.

## Prerequisites

* Java (version 8 or greater): make sure you have `java` on your `PATH` or `JAVA_HOME` in your environment. Java is needed to run the language server.

## Install 

Install this extension from the [Marketplace](https://marketplace.visualstudio.com/items?itemName=buntec.vscode-scalavista).

## Usage

The extension is activated upon opening any Scala source
file (`*.scala`).

On activation it will query GitHub for the latest [release](https://github.com/buntec/scalavista-server/releases) of [scalavista-server](https://github.com/buntec/scalavista-server).
If a more recent version is found, the user is prompted to allow automatic downloading.
Finally, the extension will launch a language server
instance as a subprocess, which may take a few seconds. 
Once the server is running the extension becomes fully functional.

To get the most out of this extension, especially for larger
projects or those with external dependencies, a `scalavista.json`
file should be created at the root of your project (workspace). 
Have a look [here](https://github.com/buntec/scalavista-server) for details.
If you are using sbt, then the [sbt-scalavista](https://github.com/buntec/sbt-scalavista)
 plugin can generate this file for you.