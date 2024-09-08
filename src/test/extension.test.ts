import * as assert from 'assert';
import * as vscode from 'vscode';
import { deactivate } from '../extension';

suite('Extension Test Suite', () => {
    vscode.window.showInformationMessage('Start all tests.');

    setup(async () => {
        // Ensures a clean slate before each test
        await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    });

    teardown(async () => {
        // Fechar todos os editores após cada teste
        await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    });

    test('Activation Test', async () => {
        const extension = vscode.extensions.getExtension('gusilveiramp.loglive');
        assert.ok(extension, 'Extension should be present');
        await extension.activate();
        assert.strictEqual(extension.isActive, true, "Extension should be active");
    });

    test('Decoration Test', async function() {
        await vscode.commands.executeCommand('workbench.action.files.newUntitledFile');
        const editor = vscode.window.activeTextEditor;
        assert.ok(editor, 'Active editor should be available for decoration test');
        const text = `console.log(2 + 2);`;
        await editor.edit(editBuilder => editBuilder.insert(new vscode.Position(0, 0), text));
        assert.strictEqual(editor.document.lineAt(0).text, text, 'The text should be inserted correctly');
    });
	
	test('Configuration Test', async function() {
        this.timeout(10000); // Increase timeout to 10 seconds
        let config = vscode.workspace.getConfiguration('loglive');
        console.log("Initial value:", config.get('showAllExpressions'));

        await config.update('showAllExpressions', true, vscode.ConfigurationTarget.Global);
        await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for setting to apply
        config = vscode.workspace.getConfiguration('loglive');
        assert.strictEqual(config.get('showAllExpressions'), true, "showAllExpressions should be true");

        await config.update('showAllExpressions', false, vscode.ConfigurationTarget.Global);
        await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for setting to apply
        config = vscode.workspace.getConfiguration('loglive');
        assert.strictEqual(config.get('showAllExpressions'), false, "showAllExpressions should be false");
	});

    test('Deactivation Cleanup Test', function() {
        deactivate();
    });
});