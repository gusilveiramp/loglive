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
            vscode.window.showInformationMessage('Configuração de Exibição de Expressões atualizada!');
        }
    }));

    // Adiciona um ouvinte para mudanças no documento (toda vez que o usuário edita o código)
    const disposable = vscode.workspace.onDidChangeTextDocument(event => {
        const editor = vscode.window.activeTextEditor;
        if (editor && event.document === editor.document) {
            const document = editor.document;
            const text = document.getText();

            clearDecorations(editor); // Limpa as decorações anteriores

            // Cria a AST (Arvore de Sintaxe Abstrata) a partir do texto do documento
            const ast = parser.parse(text, {
                sourceType: 'module',
                plugins: ['typescript']
            });

            // Primeiro, populamos o globalScope antes de qualquer avaliação
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

                        console.log("AQUI");
                        populateGlobalScope(importAst, fileContent);
                    }
                }
            });

            // Após garantir que o globalScope está populado, avaliamos as expressões
            populateGlobalScope(ast, text);  // Certifique-se de que o globalScope foi populado corretamente

            // Chame a função de verificação para garantir que as funções foram adicionadas
            testGlobalScope();  // Certifica-se de que as funções estão no globalScope

            // Agora que o escopo está preenchido, podemos avaliar as expressões e variáveis
            evaluateExpressions(ast, editor, document);
        }
    });

    // Inscreve o ouvinte para ser descartado quando a extensão for desativada
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

// Função para preencher o escopo global com variáveis e funções definidas no código do usuário e também no código importado
function populateGlobalScope(ast: any, code: string) {
    const functionsToAdd: { [key: string]: string } = {};

    traverse(ast, {
        enter(path) {
            if ((path.isFunctionDeclaration() || path.isVariableDeclarator()) && path.node.id && path.node.id.type === 'Identifier') {
                const name = path.node.id.name;
                let declarationCode = code.substring(path.node.start!, path.node.end!);

                // Remove TypeScript type annotations
                declarationCode = declarationCode.replace(/: [\w\[\]\|]+/g, '');

                // Armazena o código da função para ser adicionado depois
                functionsToAdd[name] = declarationCode;
            }
        }
    });

    // Adiciona todas as funções ao globalScope antes de qualquer avaliação de variáveis
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

// Função que avalia as expressões encontradas no código e insere o resultado no editor
function evaluateExpressions(ast: any, editor: vscode.TextEditor, document: vscode.TextDocument) {
    const showAllExpressions = vscode.workspace.getConfiguration().get<boolean>('loglive.showAllExpressions');
    console.log("Evaluating expressions, showAllExpressions:", showAllExpressions);

    traverse(ast, {
        ExpressionStatement(path) {
            if (showAllExpressions && path.node.expression) {   
                const expressionCode = generateCodeForNode(path.node.expression, document);
                console.log("Expression code:", expressionCode);

                // Verificar se todas as dependências estão no globalScope antes de avaliar a expressão
                try {
                    const result = new Function('globalScope', `with(globalScope) { return ${expressionCode}; }`)(globalScope);
                    console.log("Evaluated result:", result);

                    // Insere o resultado no editor
                    insertResultDecoration(path.node, editor, document, result);
                } catch (err:any) {
                    console.error(`Erro ao avaliar expressão ${expressionCode}: ${err}`);
                    vscode.window.showErrorMessage(`Erro ao avaliar a expressão ${expressionCode}: ${err.message}`);
                }
            } 
        },
        VariableDeclarator(path) {
            if (showAllExpressions && path.node.id.type === 'Identifier') {
                const variableName = path.node.id.name;
                const initNode = path.node.init;
    
                if (initNode) {
                    const variableCode = generateCodeForNode(initNode, document);
                    console.log(`Atribuindo o valor da variável: ${variableName}`);
    
                    try {
                        // Avalia a expressão que foi atribuída à variável
                        const value = new Function('globalScope', `with(globalScope) { return ${variableCode}; }`)(globalScope);
    
                        // Insere o valor da variável no editor
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
                
                // Captura os argumentos do console.log
                const argumentCode = path.node.arguments.map(arg => generateCodeForNode(arg, document)).join(', ');
                try {
                    // Avalia o console.log no escopo global
                    const result = new Function('globalScope', `with(globalScope) { return ${argumentCode}; }`)(globalScope);

                    // Insere o resultado no editor
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

// Antes de avaliar as expressões, adicione um log para garantir que `getSum` foi realmente adicionado ao globalScope.
console.log("Funções no escopo global:", Object.keys(globalScope));
// Função para testar se o escopo global foi corretamente populado
function testGlobalScope() {
    if (globalScope.getSum2) {
        console.log("getSum2 está definida no escopo global");
    } else {
        console.log("getSum2 não está definida no escopo global");
    }
    console.log("Funções no escopo global:", Object.keys(globalScope));
}

// Chame esta função após o populateGlobalScope e antes de avaliar as expressões
testGlobalScope();