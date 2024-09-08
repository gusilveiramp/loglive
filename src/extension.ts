import * as vscode from 'vscode';
import * as parser from '@babel/parser';
import traverse from '@babel/traverse';

let decorations: vscode.TextEditorDecorationType[] = [];
let globalScope: any = {};

export function activate(context: vscode.ExtensionContext) {
    console.log('LogLive extension activated!');
	console.log(vscode.extensions.all.map(ext => ext.id));

	context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('loglive.showAllExpressions')) {
            // A configuração mudou, atualize o comportamento da extensão
            vscode.window.showInformationMessage('Configuração de Exibição de Expressões atualizada!');
        }
    }));

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

export function populateGlobalScope(ast: any, code: string) {
	traverse(ast, {
        enter(path) {
            if ((path.isFunctionDeclaration() || path.isVariableDeclarator()) && path.node.id && path.node.id.type === 'Identifier') {
                const name = path.node.id.name;
                const declarationCode = code.substring(path.node.start!, path.node.end!);
                globalScope[name] = new Function(`return (${declarationCode})`)();
            }
        }
    });
}

function evaluateExpressions(ast: any, editor: vscode.TextEditor, document: vscode.TextDocument) {
    const showAllExpressions = vscode.workspace.getConfiguration().get<boolean>('loglive.showAllExpressions');

    traverse(ast, {
        ExpressionStatement(path) {
            if (showAllExpressions) {
                if (path.node.expression) {
                    const expressionCode = generateCodeForNode(path.node.expression, document);
                    try {
                        const result = new Function('globalScope', `with(globalScope) { return ${expressionCode}; }`)(globalScope);
                        insertResultDecoration(path.node, editor, document, result);
                    } catch (err) {
                        console.error(`Erro ao avaliar expressão: ${err}`);
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
    // Se você tiver listeners registrados, eles devem ser descartados
    vscode.workspace.onDidChangeConfiguration(() => {}).dispose();
}
