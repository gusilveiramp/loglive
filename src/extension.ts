import * as vscode from 'vscode';
import * as parser from '@babel/parser'; // Converts source code into an Abstract Syntax Tree (AST)
import traverse from '@babel/traverse'; // Traverses the AST to perform actions based on nodes
import fs from 'node:fs';
import path from 'node:path';
import * as util from 'node:util';

// Stores decoration objects to be displayed in the editor
let decorations: vscode.TextEditorDecorationType[] = [];
// Stores global variables and functions from the user's code
let globalScope: any = {};

// Main function executed when the extension is activated
export function activate(context: vscode.ExtensionContext) {
    console.log('LogLive extension activated!'); 
    
    // Listens for configuration changes in the extension
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('loglive.showAllExpressions')) {
            vscode.window.showInformationMessage('Expression Display Configuration updated!');
        }
    }));

    // Adds a listener for document changes (triggers when the user edits the code)
    const disposable = vscode.workspace.onDidChangeTextDocument(event => {
        const editor = vscode.window.activeTextEditor;
        if (editor && event.document === editor.document) {
            const document = editor.document;
            const text = document.getText();

            clearDecorations(editor); // Clears previous decorations

            // Creates an AST from the document's text
            const ast = parser.parse(text, {
                sourceType: 'module',
                plugins: ['typescript']
            });

            // Populates globalScope with imports before evaluating expressions
            traverse(ast, {
                ImportDeclaration(filePath) {
                    const importPath = filePath.node.source.value;
                    const documentPath = document.uri.fsPath;
                    const resolvedPath = resolveImportPath(importPath, documentPath);

                    if (resolvedPath && fs.existsSync(resolvedPath)) {
                        const fileContent = fs.readFileSync(resolvedPath, 'utf-8');
                        const importAst = parser.parse(fileContent, {
                            sourceType: 'module',
                            plugins: ['typescript']
                        });

                        console.log("Processing import...");
                        populateGlobalScope(importAst, fileContent);
                    }
                }
            });

            // Populates globalScope with functions and variables from the current file
            populateGlobalScope(ast, text);  

            // Verifies the functions in globalScope
            testGlobalScope();  

            // Evaluates expressions and variables in the current scope
            evaluateExpressions(ast, editor, document);
        }
    });

    // Ensures the listener is disposed of when the extension is deactivated
    context.subscriptions.push(disposable);
}

// Resolves the path of the imported file
function resolveImportPath(importPath: string, documentPath: string): string | null {
    const directory = path.dirname(documentPath); // Current file's directory
    const extensions = ['.ts', '.js', '.tsx', '.jsx']; // Possible file extensions to search for

    for (const ext of extensions) {
        const fullPath = path.join(directory, `${importPath}${ext}`);
        console.log('FULL PATH', fullPath);
        if (fs.existsSync(fullPath)) {
            return fullPath;
        }
    }
    return null;
}

// Clears previous decorations in the editor
function clearDecorations(editor: vscode.TextEditor) {
    decorations.forEach(decoration => editor.setDecorations(decoration, []));
    decorations = []; // Reset decorations array
}

// Populates the global scope with functions and variables from the code and imports
function populateGlobalScope(ast: any, code: string) {
    const functionsToAdd: { [key: string]: string } = {};

    traverse(ast, {
        enter(path) {
            if ((path.isFunctionDeclaration() || path.isVariableDeclarator()) && path.node.id && path.node.id.type === 'Identifier') {
                const name = path.node.id.name;
                let declarationCode = code.substring(path.node.start!, path.node.end!);

                // Removes TypeScript type annotations
                declarationCode = declarationCode.replace(/: [\w\[\]\|]+/g, '');

                // Stores the function code to be added later
                functionsToAdd[name] = declarationCode;
            }
        }
    });

    // Adds all functions to globalScope
    Object.keys(functionsToAdd).forEach(name => {
        try {
            if (!globalScope[name]) {
                globalScope[name] = new Function('globalScope', `with(globalScope) { return (${functionsToAdd[name]}); }`)(globalScope);
                console.log(`Successfully added ${name} to globalScope`);
            } else {
                console.log(`${name} already exists in global scope`);
            }
        } catch (error) {
            console.error(`Error adding ${name} to globalScope: ${error}`);
        }
    });
    
    console.log("Global scope updated:", Object.keys(globalScope));
}

// Evaluates the expressions in the code and inserts the result into the editor
function evaluateExpressions(ast: any, editor: vscode.TextEditor, document: vscode.TextDocument) {
    const showAllExpressions = vscode.workspace.getConfiguration().get<boolean>('loglive.showAllExpressions');
    console.log("Evaluating expressions, showAllExpressions:", showAllExpressions);

    traverse(ast, {
        ExpressionStatement(path) {
            if (showAllExpressions && path.node.expression) {   
                const expressionCode = generateCodeForNode(path.node.expression, document);
                console.log("Expression code:", expressionCode);

                try {
                    // Evaluates the expression using the global scope
                    const result = new Function('globalScope', `with(globalScope) { return ${expressionCode}; }`)(globalScope);
                    console.log("Evaluated result:", result);

                    // Inserts the result into the editor
                    insertResultDecoration(path.node, editor, document, result);
                } catch (err: any) {
                    console.error(`Error evaluating expression ${expressionCode}: ${err}`);
                }
            } 
        },
        VariableDeclarator(path) {
            if (showAllExpressions && path.node.id.type === 'Identifier') {
                const variableName = path.node.id.name;
                const initNode = path.node.init;
    
                if (initNode) {
                    const variableCode = generateCodeForNode(initNode, document);
                    console.log(`Assigning value to variable: ${variableName}`);
    
                    try {
                        // Evaluates the expression assigned to the variable
                        const value = new Function('globalScope', `with(globalScope) { return ${variableCode}; }`)(globalScope);
    
                        // Inserts the variable's value into the editor
                        insertResultDecoration(initNode, editor, document, value);
                    } catch (err) {
                        console.error(`Error evaluating variable ${variableName}: ${err}`);
                    }
                }
            }
        },
        CallExpression(path) {
            if (path.node.callee.type === 'MemberExpression' &&
                path.node.callee.object.type === 'Identifier' &&
                path.node.callee.object.name === 'console' &&
                path.node.callee.property.type === 'Identifier' &&
                path.node.callee.property.name === 'log') {
                
                // Captures the arguments of console.log
                const argumentCode = path.node.arguments.map(arg => generateCodeForNode(arg, document)).join(', ');
                try {
                    // Evaluates console.log in the global scope
                    const result = new Function('globalScope', `with(globalScope) { return ${argumentCode}; }`)(globalScope);

                    // Inserts the result into the editor
                    insertResultDecoration(path.node, editor, document, result);
                } catch (err) {
                    console.error(`Error evaluating expression: ${err}`);
                }
            }
        }
    });
}

// Generates the source code from an AST node
function generateCodeForNode(node: any, document: vscode.TextDocument): string {
    const start = node.loc?.start;
    const end = node.loc?.end;

    // Returns the source code corresponding to the node's range
    return start && end ? document.getText(new vscode.Range(
        new vscode.Position(start.line - 1, start.column),
        new vscode.Position(end.line - 1, end.column)
    )) : '';
}

// Inserts a decoration (result of the expression) into the editor
function insertResultDecoration(node: any, editor: vscode.TextEditor, document: vscode.TextDocument, result: any) {
    if (result !== undefined) {
        const startLine = node.loc?.start.line;
        const line = (startLine ? startLine - 1 : 0);
        const endCharacter = document.lineAt(line).range.end.character;
        
        let resultString: string;

        if (typeof result === 'object') {
            try {
                resultString = util.inspect(result, { depth: null, colors: false });
            } catch (e) {
                resultString = '[Cannot inspect object]';
            }
        } else {
            resultString = String(result);
        }

        const decorationType = vscode.window.createTextEditorDecorationType({
            after: {
                contentText: ` // ${resultString}`,
                color: 'gray'
            }
        });

        editor.setDecorations(decorationType, [new vscode.Range(
            new vscode.Position(line, endCharacter),
            new vscode.Position(line, endCharacter)
        )]);
        decorations.push(decorationType);
    }
}

export function deactivate() {
    const editor = vscode.window.activeTextEditor;
    if (editor && decorations.length > 0) {
        clearDecorations(editor);
    }
    // Dispose of registered listeners
    vscode.workspace.onDidChangeConfiguration(() => {}).dispose();
}

// Test if the global scope is correctly populated
function testGlobalScope() {
    if (globalScope.getSum2) {
        console.log("getSum2 is defined in the global scope");
    } else {
        console.log("getSum2 is not defined in the global scope");
    }
    console.log("Functions in global scope:", Object.keys(globalScope));
}

// Call this function after populating globalScope and before evaluating expressions
testGlobalScope();
