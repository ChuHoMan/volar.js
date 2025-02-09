import * as shared from '@volar/shared';
import { posix as path } from 'path';
import type * as vscode from 'vscode-languageserver-protocol';
import type { LanguageServicePluginContext } from '../types';
import * as dedupe from '../utils/dedupe';
import { languageFeatureWorker } from '../utils/featureWorkers';

export interface PluginCallHierarchyData {
	uri: string,
	original: Pick<vscode.CallHierarchyItem, 'data'>,
	pluginId: string,
	map: {
		embeddedDocumentUri: string;
	} | undefined,
}

export function register(context: LanguageServicePluginContext) {

	return {

		doPrepare(uri: string, position: vscode.Position) {

			return languageFeatureWorker(
				context,
				uri,
				position,
				(position, map) => map.toGeneratedPositions(position, data => !!data.references),
				async (plugin, document, position, map) => {

					const items = await plugin.callHierarchy?.prepare(document, position);

					items?.forEach(item => {
						item.data = {
							uri,
							original: {
								data: item.data,
							},
							pluginId: Object.keys(context.plugins).find(key => context.plugins[key] === plugin)!,
							map: map ? {
								embeddedDocumentUri: map.virtualFileDocument.uri,
							} : undefined,
						} satisfies PluginCallHierarchyData;
					});

					return items;
				},
				(data, sourceMap) => !sourceMap ? data : data
					.map(item => transformCallHierarchyItem(item, [])?.[0])
					.filter(shared.notEmpty),
				arr => dedupe.withLocations(arr.flat()),
			);
		},

		async getIncomingCalls(item: vscode.CallHierarchyItem) {

			const data: PluginCallHierarchyData | undefined = item.data;
			let incomingItems: vscode.CallHierarchyIncomingCall[] = [];

			if (data) {

				const plugin = context.plugins[data.pluginId];

				if (!plugin.callHierarchy)
					return incomingItems;

				Object.assign(item, data.original);

				if (data.map) {

					if (context.documents.hasVirtualFileByUri(data.map.embeddedDocumentUri)) {

						const _calls = await plugin.callHierarchy.onIncomingCalls(item);

						for (const _call of _calls) {

							const calls = transformCallHierarchyItem(_call.from, _call.fromRanges);

							if (!calls)
								continue;

							incomingItems.push({
								from: calls[0],
								fromRanges: calls[1],
							});
						}
					}
				}
				else {

					const _calls = await plugin.callHierarchy.onIncomingCalls(item);

					for (const _call of _calls) {

						const calls = transformCallHierarchyItem(_call.from, _call.fromRanges);

						if (!calls)
							continue;

						incomingItems.push({
							from: calls[0],
							fromRanges: calls[1],
						});
					}
				}
			}

			return dedupe.withCallHierarchyIncomingCalls(incomingItems);
		},

		async getOutgoingCalls(item: vscode.CallHierarchyItem) {

			const data: PluginCallHierarchyData | undefined = item.data;
			let items: vscode.CallHierarchyOutgoingCall[] = [];

			if (data) {

				const plugin = context.plugins[data.pluginId];

				if (!plugin.callHierarchy)
					return items;

				Object.assign(item, data.original);

				if (data.map) {

					if (context.documents.hasVirtualFileByUri(data.map.embeddedDocumentUri)) {

						const _calls = await plugin.callHierarchy.onOutgoingCalls(item);

						for (const call of _calls) {

							const calls = transformCallHierarchyItem(call.to, call.fromRanges);

							if (!calls)
								continue;

							items.push({
								to: calls[0],
								fromRanges: calls[1],
							});
						}
					}
				}
				else {

					const _calls = await plugin.callHierarchy.onOutgoingCalls(item);

					for (const call of _calls) {

						const calls = transformCallHierarchyItem(call.to, call.fromRanges);

						if (!calls)
							continue;

						items.push({
							to: calls[0],
							fromRanges: calls[1],
						});
					}
				}
			}

			return dedupe.withCallHierarchyOutgoingCalls(items);
		},
	};

	function transformCallHierarchyItem(tsItem: vscode.CallHierarchyItem, tsRanges: vscode.Range[]): [vscode.CallHierarchyItem, vscode.Range[]] | undefined {

		if (!context.documents.hasVirtualFileByUri(tsItem.uri))
			return [tsItem, tsRanges];

		for (const [_, map] of context.documents.getMapsByVirtualFileUri(tsItem.uri)) {

			let range = map.toSourceRange(tsItem.range);
			if (!range) {
				// TODO: <script> range
				range = {
					start: map.sourceFileDocument.positionAt(0),
					end: map.sourceFileDocument.positionAt(map.sourceFileDocument.getText().length),
				};
			}

			const selectionRange = map.toSourceRange(tsItem.selectionRange);
			if (!selectionRange)
				continue;

			const vueRanges = tsRanges.map(tsRange => map.toSourceRange(tsRange)).filter(shared.notEmpty);
			const vueItem: vscode.CallHierarchyItem = {
				...tsItem,
				name: tsItem.name === path.basename(shared.uriToFileName(map.virtualFileDocument.uri)) ? path.basename(shared.uriToFileName(map.sourceFileDocument.uri)) : tsItem.name,
				uri: map.sourceFileDocument.uri,
				// TS Bug: `range: range` not works
				range: {
					start: range.start,
					end: range.end,
				},
				selectionRange: {
					start: selectionRange.start,
					end: selectionRange.end,
				},
			};

			selectionRange.end;

			return [vueItem, vueRanges];
		}
	}
}
