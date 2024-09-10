import * as vscode from 'vscode';
import * as parser from '@babel/parser'; // Usado para converter o código fonte em uma arvore de sintaxe abstrata (AST)
import traverse from '@babel/traverse'; // Usado para percorrer a AST e executar ações com base nos nós
import fs from 'node:fs';
import path from 'node:path';
 
// Variável para armazenar os objetos de decoração que serão exibidos no editor
let decorations: vscode.TextEditorDecorationType[] = [];
// Objeto usado para armazenar variáveis e funções globais do código que o usuário está editando
let globalScope: any = {};

// Função principal que é executada quando a extensão é ativada
export function activate(context: vscode.ExtensionContext) {
    console.log('LogLive extension activated!'); 
    
    // Observa mudanças nas configurações da extensão
	context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('loglive.showAllExpressions')) {
            // Se a configuração "loglive.showAllExpressions" for alterada, exibe uma notificação para o usuário
            vscode.window.showInformationMessage('Configuração de Exibição de Expressões atualizada!');
        }
    }));

    // Adiciona um ouvinte para mudanças no documento (toda vez que o usuário edita o código)
    const disposable = vscode.workspace.onDidChangeTextDocument(event => {
        const editor = vscode.window.activeTextEditor;
        if (editor && event.document === editor.document) {
            const document = editor.document; // pega o editor ativo
            const text = document.getText(); // pega o texto completo do documento

            clearDecorations(editor); // limpa qualquer decoração anterior

            // cria a AST (Arvore de Sintaxe Abstrata) a partir do texto do documento
            const ast = parser.parse(text, {
                sourceType: 'module',
                plugins: ['typescript']
            });

            console.log("ast", ast);
            console.log("text", text);

            traverse(ast, {
                ImportDeclaration(filePath) {
                    const importPath = filePath.node.source.value; // Caminho do arquivo importado
                    const documentPath = document.uri.fsPath;
                    const resolvedPath = resolveImportPath(importPath, documentPath);

                    if (resolvedPath && fs.existsSync(resolvedPath)) {
                        const fileContent = fs.readFileSync(resolvedPath, 'utf-8');
                        const importAst = parser.parse(fileContent, {
                            sourceType: 'module',
                            plugins: ['typescript']
                        });
                        
                        console.log("importAst", importAst);
                        console.log("fileContent", fileContent);

                        populateGlobalScope(importAst, fileContent);
                    }
                }
            });

            // preenche o escopo global com funções e variáveis definidas no código
            populateGlobalScope(ast, text);
            // avalia as expressões encontradas no código e exibe os resultados no editor
            evaluateExpressions(ast, editor, document);
        }
    });

    // inscreve o ouvinte para ser descartado quando a extensão for desativada
    context.subscriptions.push(disposable);
}

// Função para resolver o caminho do arquivo importado
function resolveImportPath(importPath: string, documentPath: string): string | null {
    const directory = path.dirname(documentPath); // Pega o diretório do arquivo atual
    const extensions = ['.ts', '.js', '.tsx', '.jsx']; // Extensões que podemos procurar

    for (const ext of extensions) {
        const fullPath = path.join(directory, `${importPath}${ext}`);
        console.log('FULL PATH', fullPath);
        if (fs.existsSync(fullPath)) {
            return fullPath;
        }
    }
    return null;
}


// Função para limpar as docorações que foram inseridas anteriormente
function clearDecorations(editor: vscode.TextEditor) {
    // remove todas as decorações do editor
    decorations.forEach(decoration => editor.setDecorations(decoration, []));
    decorations = []; // limpa no array de decorações
}

// Função para preencher o escopo global com variáveis e funções definidas no código do usuário
export function populateGlobalScope(ast: any, code: string) {
    traverse(ast, {
        enter(path) {
            if ((path.isFunctionDeclaration() || path.isVariableDeclarator()) && path.node.id && path.node.id.type === 'Identifier') {
                const name = path.node.id.name;
                let declarationCode = code.substring(path.node.start!, path.node.end!);

                // Remove TypeScript type annotations (this is a simplified regex)
                declarationCode = declarationCode.replace(/: [\w\[\]\|]+/g, '');

                console.log(`Populating global scope with ${name}: ${declarationCode}`);
                
                try {
                    if (!globalScope[name]) {
                        globalScope[name] = new Function(`return (${declarationCode})`)();
                        console.log(`Successfully added ${name} to globalScope`);
                    } else {
                        console.log(`${name} already exists in global scope`);
                    }
                } catch (error) {
                    console.error(`Error adding ${name} to globalScope: ${error}`);
                }

                console.log("Global scope after population:", globalScope);
            }
        }
    });
}

// Função que avalia as expressões encontradas no código e insere o resultado no editor
function evaluateExpressions(ast: any, editor: vscode.TextEditor, document: vscode.TextDocument) {
    const showAllExpressions = vscode.workspace.getConfiguration().get<boolean>('loglive.showAllExpressions');
    console.log("Evaluating expressions, showAllExpressions:", showAllExpressions);

    // Percorre a AST em busca de expressões
    traverse(ast, {
        // verifica se o nó é uma expressão
        ExpressionStatement(path) { 
            console.log("ExpressionStatement found:", path.node);
            if (showAllExpressions) { // se a configuração estiver ativada
                if (path.node.expression) {
                    // gera o código para a expressão atual
                    const expressionCode = generateCodeForNode(path.node.expression, document);
                    console.log("ExpressionStatement found:", path.node);
                    console.log("Generated expression code:", expressionCode);
                    try {
                        // avalia a expressão no contexto do escopo global
                        const result = new Function('globalScope', `with(globalScope) { return ${expressionCode}; }`)(globalScope);
                        console.log("Evaluated result:", result);
                        // insere o resultao da avaliação no editor
                        insertResultDecoration(path.node, editor, document, result);
                    } catch (err) {
                        console.error(`Erro ao avaliar expressão ${expressionCode}: ${err}`);

                    }
                }
            }
        },
        // Verifica se o nó é uma chamada de console.log
        CallExpression(path) {
            console.log("CallExpression found:", path.node);
            if (path.node.callee.type === 'MemberExpression' &&
                path.node.callee.object.type === 'Identifier' &&
                path.node.callee.object.name === 'console' &&
                path.node.callee.property.type === 'Identifier' &&
                path.node.callee.property.name === 'log') {
                // se for uma chamada de console.log, pega o código dos argumentos
                const argumentCode = path.node.arguments.map(arg => generateCodeForNode(arg, document)).join(', ');
                try {
                    // avalia os argumentos da chamada no escopo global
                    const result = new Function('globalScope', `with(globalScope) { return ${argumentCode}; }`)(globalScope);
                    console.log("Console.log result:", result);
                    // insere o resultado da avaliação no editor
                    insertResultDecoration(path.node, editor, document, result);
                } catch (err) {
                    console.error(`Erro ao avaliar expressão: ${err}`);
                }
            }
        }
    });
}

// Função para gerar o código fonte a partir de um nó da AST
function generateCodeForNode(node: any, document: vscode.TextDocument): string {
    const start = node.loc?.start; // pega a posição inicial do nó
    const end = node.loc?.end; // pega a posição final do nó

    // retorna o código fonte correspondente ao intervalo do nó
    return start && end ? document.getText(new vscode.Range(
        new vscode.Position(start.line - 1, start.column),
        new vscode.Position(end.line - 1, end.column)
    )) : '';
}

// Função para inserir uma decoração (resultado da expressão) no editor
function insertResultDecoration(node: any, editor: vscode.TextEditor, document: vscode.TextDocument, result: any) {
    console.log("Inserting decoration for expression:", result);
	if (result !== undefined) { // se houver um resultado
		const startLine = node.loc?.start.line; // linha onde a expressão está localizada
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