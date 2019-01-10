# vscode-scalavista

![](demo2.gif)

A Visual Studio Code extension that provides basic IDE-like functionality for the Scala language (2.11 and 2.12):

* Show type on hover;
* Show Scaladoc on hover;
* Auto-completion;
* Jump to definition (does not currently work for external dependencies);
* Linting (compiler errors/warnings show up as you type).

Scalavista is not as feature-complete as [ENSIME](https://github.com/ensime) but instead aims 
to be minimalistic and lightweight.

The VSCode extension is a front-end to the [scalavista](https://github.com/buntec/scalavista) language-server, 
which in turn is a thin wrapper around Scala's presentation compiler.

## Prerequisites

* [scalavista-server](https://github.com/buntec/scalavista-server);
* [sbt](https://www.scala-sbt.org) and the [sbt-scalavista](https://github.com/buntec/sbt-scalavista) plugin
are recommended. 

## Install 

* Install this extension from the Marketplace.

## Usage

See [scalavista-server](https://github.com/buntec/scalavista-server) on how to set up and launch scalavista-server.
Once a server is running, the VSCode extension will connect to it upon opening any Scala source file.

## Disclaimer

This project is in alpha stage and should be considered unstable. 
