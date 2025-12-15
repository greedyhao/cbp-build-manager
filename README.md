# CBP Build Manager

A VS Code extension for managing and building Code::Blocks projects (.cbp files) using Ninja.

## Features

- **Scan Projects**: Automatically finds all .cbp files in your workspace
- **Checkbox Selection**: Choose which projects to build
- **Drag & Drop Ordering**: Reorder projects to control build sequence
- **Ninja Integration**: Generates and runs Ninja build files
- **Build Output**: Shows build logs in VS Code terminal and output panel

## Usage

1. **Open Workspace**: Open a folder containing Code::Blocks projects (.cbp files)
2. **Access Extension**: Click on the CBP Builder icon in the Activity Bar
3. **Refresh Projects**: Click the refresh button to scan for .cbp files
4. **Select Projects**: Check the boxes next to projects you want to build
5. **Reorder Projects**: Drag and drop projects to set the build order
6. **Build**: Click the play button to start building selected projects

## Build Process

1. The extension scans your workspace for .cbp files
2. You select which projects to build and set the order
3. For each selected project:
   - Generates a Ninja build file (using an external converter tool)
   - Runs Ninja to compile the project
4. Build output is shown in the terminal and output panel

## Requirements

- VS Code 1.107.0 or later
- Ninja build system
- External CBP to Ninja converter tool

## Extension Settings

No settings available yet.

## Known Issues

- Converter tool path is hardcoded (placeholder implementation)
- No error handling for missing converter tool
- No configuration for build targets (Debug/Release)

## Contributing

Feel free to open issues or submit pull requests.

## License

MIT
