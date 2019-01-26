# vscode-scalavista

![](demo2.gif)

A Visual Studio Code extension that provides IDE-like functionality
for the Scala language (2.11.x and 2.12.x):

* Show type on hover;
* Show Scaladoc on hover;
* Auto-completion;
* Jump to definition (does not currently work for external dependencies);
* Linting (compiler errors/warnings show up as you type).

The extension is a front-end to the [scalavista-server](https://github.com/buntec/scalavista-server)
language server, which in turn is a thin wrapper around Scala's presentation compiler.

## Prerequisites

* [scalavista-server](https://github.com/buntec/scalavista-server);
* [sbt](https://www.scala-sbt.org) and the [sbt-scalavista](https://github.com/buntec/sbt-scalavista) plugin are recommended. 

## Install 

Install this extension from the [Marketplace](https://marketplace.visualstudio.com/items?itemName=buntec.vscode-scalavista).

## Usage

See [scalavista-server](https://github.com/buntec/scalavista-server) on how to
set up and launch a server (easy!) - the extension will connect to it
upon opening any Scala source file.

## Caveats

This extension does not provide syntax highlighting. We recommend [the official Scala syntax extension](https://marketplace.visualstudio.com/items?itemName=scala-lang.scala).
