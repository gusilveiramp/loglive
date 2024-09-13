import * as vscode from 'vscode';
import * as parser from '@babel/parser'; 
import traverse from '@babel/traverse'; 

let decorations: vscode.TextEditorDecorationType[] = [];
let globalScope: any = {};

export function activate(context: vscode.ExtensionContext) {
    console.log('LogLive extension activated!'); 

    const disposable = vscode.workspace.onDidChangeTextDocument(event => {
        const editor = vscode.window.activeTextEditor;
        if (editor && event.document === editor.document) {
            const document = editor.document;
            const text = document.getText();

            clearDecorations(editor);

            const ast = parser.parse(text, {
                sourceType: 'module',
                plugins: ['typescript']
            });

            populateGlobalScope(ast, text);
            evaluateExpressions(ast, editor, document);
        }
    });

    context.subscriptions.push(disposable);
}

function clearDecorations(editor: vscode.TextEditor) {
    decorations.forEach(decoration => editor.setDecorations(decoration, []));
    decorations = [];
}

function populateGlobalScope(ast: any, code: string) {
    const functionsToAdd: { [key: string]: string } = {};

    traverse(ast, {
        enter(path) {
            if ((path.isFunctionDeclaration() || path.isVariableDeclarator()) && path.node.id && path.node.id.type === 'Identifier') {
                const name = path.node.id.name;
                let declarationCode = code.substring(path.node.start!, path.node.end!);

                declarationCode = declarationCode.replace(/: [\w\[\]\|]+/g, '');
                functionsToAdd[name] = declarationCode;
            }
        }
    });

    Object.keys(functionsToAdd).forEach(name => {
        try {
            if (!globalScope[name]) {
                globalScope[name] = new Function('globalScope', `with(globalScope) { return (${functionsToAdd[name]}); }`)(globalScope);
                console.log(`Successfully added ${name} to globalScope`);
            }
        } catch (error) {
            console.error(`Error adding ${name} to globalScope: ${error}`);
        }
    });

    console.log("Global scope updated:", Object.keys(globalScope));
}

function evaluateExpressions(ast: any, editor: vscode.TextEditor, document: vscode.TextDocument) {
    const showAllExpressions = vscode.workspace.getConfiguration().get<boolean>('loglive.showAllExpressions');
    console.log("Evaluating expressions, showAllExpressions:", showAllExpressions);

    traverse(ast, {
        ExpressionStatement(path) {
            if (showAllExpressions && path.node.expression) {   
                const expressionCode = generateCodeForNode(path.node.expression, document);
                try {
                    const result = new Function('globalScope', `with(globalScope) { return ${expressionCode}; }`)(globalScope);
                    insertResultDecoration(path.node, editor, document, result);
                } catch (err: any) {
                    console.error(`Erro ao avaliar expressão ${expressionCode}: ${err}`);
                }
            } 
        },
        VariableDeclarator(path) {
            if (showAllExpressions && path.node.id.type === 'Identifier') {
                const variableName = path.node.id.name;
                const initNode = path.node.init;

                if (initNode) {
                    const variableCode = generateCodeForNode(initNode, document);
                    try {
                        const value = new Function('globalScope', `with(globalScope) { return ${variableCode}; }`)(globalScope);
                        insertResultDecoration(initNode, editor, document, value);
                    } catch (err) {
                        console.error(`Erro ao avaliar variável ${variableName}: ${err}`);
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

                const argumentCode = path.node.arguments.map(arg => generateCodeForNode(arg, document)).join(', ');
                try {
                    const result = new Function('globalScope', `with(globalScope) { return ${argumentCode}; }`)(globalScope);
                    insertResultDecoration(path.node, editor, document, result);
                } catch (err) {
                    console.error(`Erro ao avaliar expressão: ${err}`);
                }
            }
        }
    });
}

function generateCodeForNode(node: any, document: vscode.TextDocument): string {
    const start = node.loc?.start;
    const end = node.loc?.end;

    return start && end ? document.getText(new vscode.Range(
        new vscode.Position(start.line - 1, start.column),
        new vscode.Position(end.line - 1, end.column)
    )) : '';
}

function insertResultDecoration(node: any, editor: vscode.TextEditor, document: vscode.TextDocument, result: any) {
    if (result !== undefined) {
        const startLine = node.loc?.start.line;
        const line = (startLine ? startLine - 1 : 0);
        const endCharacter = document.lineAt(line).range.end.character;

        const decorationType = vscode.window.createTextEditorDecorationType({
            after: {
                contentText: ` // ${result}`,
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
}
