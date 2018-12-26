# vscode-scalavista

A Visual Studio Code extension that provides basic IDE-like functionality for the Scala language (2.11.X and 2.12.X):

* Show type on hover;
* Show Scaladoc on hover;
* Auto-completion;
* Jump to definition (does not currently work for external dependencies);
* Linting (compiler errors/warnings are highlighted in your code).

scalavista is not as feature-complete as [ENSIME](https://github.com/ensime) but instead aims 
to be minimalistic and lightweight. (In particular, it does not work for Java sources.)

The Visual Studio Code extension is a front-end to the [scalavista](https://github.com/buntec/scalavista) language-server, 
which in turn is a thin wrapper around Scala's presentation compiler.

## Prerequisites

* Python3.
* The `install.sh` script uses `wget` to download the scalavista back-end jars 
and `pip3` to install the required Python packages.
* sbt and the [sbt-scalavista](https://github.com/buntec/sbt-scalavista) plugin are recommended. 

## Install 

Clone the [neovim-scalavista](https://github.com/buntec/neovim-scalavista) repo and execute `install.sh`,
which downloads the server jars and symlinks a launcher into your `/usr/local/bin`. 

## Usage

Run `scalavista` from the root of your project, ideally with a `scalavista.json` present. 
A scalavista server will be launched and VSCode will connect to it upon opening any Scala
source file.

For an optimal experience use the [sbt-scalavista](https://github.com/buntec/sbt-scalavista) plugin 
to generate a `scalavista.json` file for your project. This is a simple json file with the following fields:

1. `classpath` (i.e., your dependencies)
1. `scalaBinaryVersion` (2.11 or 2.12)
1. `sources` - a list of your existing Scala source files (don't worry, newly creates files will be picked up on-the-fly)
1. `scalacOptions` - a list of scalac compiler options

You can use scalavista without a `scalavista.json` with the effect that external dependencies are 
not recognized and marked as errors in your code. The exception are manually managed dependencies in `./lib` which are
automatically appended to the classpath. You may want to use the `-r` flag to instruct scalavista to look into all
subdirectories for Scala source files and not just in the current directory (this has no effect in the presence of a
`scalavista.json`). 

Use `--help` to see a list of options.

## Disclaimer

This project is in alpha stage and should be considered unstable. 
