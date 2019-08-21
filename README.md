# vscode-scalavista

![](demo2.gif)

A Visual Studio Code extension that provides IDE-like functionality
for the Scala language (2.11--2.13):

* Show type on hover;
* Show Scaladoc on hover;
* Auto-completion;
* Jump to definition (does not currently work for external dependencies);
* Linting (compiler errors/warnings show up as you type).

The extension is a front-end to the [scalavista-server](https://github.com/buntec/scalavista-server)
language server, which in turn is a thin wrapper around Scala's presentation compiler.

## Prerequisites

* Java: make sure you have `java` on your `PATH`.
* [sbt](https://www.scala-sbt.org) and the [sbt-scalavista](https://github.com/buntec/sbt-scalavista) plugin are recommended. 

## Install 

Install this extension from the [Marketplace](https://marketplace.visualstudio.com/items?itemName=buntec.vscode-scalavista).

## Usage

The extension is activated upon opening any Scala source
file. On first activation it will try to download the
latest version of the scalavista-server jars.
(The user is prompted before downloading begins.) 
Afterwards the extension will 
launch a server instance in the background. 

To get the most out of this extension, a `scalavista.json`
file should be generated using the sbt companion plugin.

Happy coding!

## Caveats

This extension does not provide syntax highlighting. We recommend [the official Scala syntax extension](https://marketplace.visualstudio.com/items?itemName=scala-lang.scala).
