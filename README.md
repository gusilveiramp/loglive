# LogLive Extension

LogLive is a Visual Studio Code extension that evaluates JavaScript and TypeScript expressions in real time within the editor and displays the results directly as comments in the code. This extension is ideal for developers who want to see immediate outcomes of their expressions without running entire scripts.

## Features

- Evaluates JavaScript and TypeScript expressions directly in the editor.
- Displays results of expressions as comments in the code.
- Configurable to display results for all expressions or only those within `console.log` calls.
- Supports automatic activation for JavaScript and TypeScript files.

## Installation

1. Open Visual Studio Code.
2. Navigate to `View` -> `Extensions`.
3. Search for "LogLive" and click `Install`.
4. Once installed, the extension will automatically activate when opening JavaScript and TypeScript files.

## Usage

The extension operates automatically upon opening `.js` and `.ts` files. Results will be displayed as comments in the code next to the evaluated expressions.

To configure the display of results:
1. Open the `Command Palette` (Cmd+Shift+P on macOS or Ctrl+Shift+P on Windows/Linux).
2. Type `Preferences: Open Settings (UI)`.
3. Search for `LogLive` and adjust the settings as needed.

## Settings

- `loglive.showAllExpressions`: Determines whether the extension should display results for all expressions or only for expressions within `console.log` calls. (Default: `false`)

## Support

If you encounter any issues or have suggestions, please open an issue in the [GitHub repository](#).

## Contributing

Contributions are welcome! If you would like to contribute, please fork the repository and submit a pull request.

## License

Distributed under the MIT License. See `LICENSE` for more information.


## TODO
✅ Should work for nested functions
⬜️ Should work for imported functions