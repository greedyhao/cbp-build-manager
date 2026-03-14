import * as assert from 'assert';
import * as vscode from 'vscode';
import { BuildTerminal, createOrShowTerminal, resetGlobalTerminal, getGlobalTerminal, getGlobalPty, setGlobalTerminal } from '../../terminal';

suite('Terminal Test Suite', () => {
    // Note: These tests require VS Code API mocking for full functionality
    // This file contains unit tests for BuildTerminal logic

    test('BuildTerminal: should initialize with isClosed false', () => {
        const terminal = new BuildTerminal();
        assert.strictEqual(terminal.getIsClosed(), false);
    });

    test('BuildTerminal: write should not throw when not closed', () => {
        const terminal = new BuildTerminal();
        // The write method uses EventEmitter, so we just verify it doesn't throw
        assert.doesNotThrow(() => {
            terminal.write('test data');
        });
    });

    test('BuildTerminal: writeRaw should not throw when not closed', () => {
        const terminal = new BuildTerminal();
        assert.doesNotThrow(() => {
            terminal.writeRaw('\x1b[32mgreen text\x1b[0m');
        });
    });

    test('BuildTerminal: write should handle ANSI codes correctly', () => {
        const terminal = new BuildTerminal();
        const { formatOutput } = require('../../utils');

        // Verify formatOutput correctly handles ANSI
        const input = '\x1b[32mgreen\x1b[0m\n';
        const output = formatOutput(input);
        assert.ok(output.includes('\x1b[32mgreen\x1b[0m'));
    });

    test('BuildTerminal: close should set isClosed to true', () => {
        const terminal = new BuildTerminal();
        terminal.close();
        assert.strictEqual(terminal.getIsClosed(), true);
    });

    test('BuildTerminal: write should not throw after close', () => {
        const terminal = new BuildTerminal();
        terminal.close();

        assert.doesNotThrow(() => {
            terminal.write('data after close');
        });
    });

    test('BuildTerminal: multiple close calls should not throw', () => {
        const terminal = new BuildTerminal();

        terminal.close();
        assert.doesNotThrow(() => {
            terminal.close();
            terminal.close();
            terminal.close();
        });
    });
});

// Note: Full integration tests for createOrShowTerminal would require
// mocking vscode.window.terminals and vscode.window.createTerminal
// These are typically run in the VS Code extension host environment
