import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	INodeExecutionData,
	INodePropertyOptions,
	INodeType,
	INodeTypeDescription,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError, sleep } from 'n8n-workflow';

// Programmatic rather than declarative: validating takes several dependent
// calls (send the document, then poll until the queued validation is done),
// and a document can come from binary data, which is sent as the raw body.

type Context = IExecuteFunctions | ILoadOptionsFunctions;

const FINISHED = ['done', 'failed', 'cancelled'];

async function api(
	this: Context,
	method: IHttpRequestMethods,
	path: string,
	options: { body?: IDataObject | Buffer | string; qs?: IDataObject; contentType?: string } = {},
): Promise<{ status: number; body: IDataObject }> {
	const credentials = await this.getCredentials('xmlvalidApi');
	const base = String(credentials.baseUrl || 'https://xmlvalid.com/api/v1').replace(/\/+$/, '');
	const isJson = options.body !== undefined && !Buffer.isBuffer(options.body) && typeof options.body === 'object';

	const request: IHttpRequestOptions = {
		method,
		url: `${base}${path}`,
		qs: options.qs,
		headers: {
			Accept: 'application/json',
			...(options.contentType ? { 'Content-Type': options.contentType } : {}),
		},
		body: isJson ? JSON.stringify(options.body) : (options.body as Buffer | string | undefined),
		json: false,
		returnFullResponse: true,
		ignoreHttpStatusErrors: true,
	};
	if (isJson) {
		request.headers!['Content-Type'] = 'application/json';
	}

	const response = (await this.helpers.httpRequestWithAuthentication.call(this, 'xmlvalidApi', request)) as {
		statusCode: number;
		body: unknown;
	};
	let body: IDataObject = {};
	if (typeof response.body === 'string' && response.body !== '') {
		try {
			body = JSON.parse(response.body) as IDataObject;
		} catch {
			body = { raw: response.body };
		}
	} else if (Buffer.isBuffer(response.body)) {
		body = JSON.parse(response.body.toString('utf8')) as IDataObject;
	} else if (response.body && typeof response.body === 'object') {
		body = response.body as IDataObject;
	}

	if (response.statusCode >= 400) {
		const error = (body.error ?? {}) as IDataObject;
		throw new NodeApiError(this.getNode(), body as JsonObject, {
			httpCode: String(response.statusCode),
			message: String(error.message ?? `The xmlvalid API answered ${response.statusCode}`),
			description: error.code ? `Error code: ${String(error.code)}` : undefined,
		});
	}

	return { status: response.statusCode, body };
}

/** The verdict and the findings, without the bookkeeping. */
function simplify(validation: IDataObject): IDataObject {
	const result = (validation.result ?? {}) as IDataObject;
	const schema = (validation.schema ?? {}) as IDataObject;
	const finding = (d: IDataObject) => ({
		line: d.line,
		level: d.level,
		rule: d.rule ?? null,
		path: d.path ?? null,
		message: d.message_en ?? d.message,
		help_url: d.rule_url ?? d.help_url ?? null,
	});

	return {
		id: validation.id,
		status: validation.status,
		valid: result.valid ?? false,
		outcome: result.outcome ?? null,
		schema: schema.catalog ?? schema.name ?? null,
		rule_sets: validation.rule_sets ?? [],
		errors_total: result.errors_total ?? 0,
		warnings_total: result.warnings_total ?? 0,
		errors: ((result.errors ?? []) as IDataObject[]).map(finding),
		warnings: ((result.warnings ?? []) as IDataObject[]).map(finding),
		sha256: result.sha256 ?? null,
		error: validation.error ?? null,
	};
}

export class Xmlvalid implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'xmlvalid',
		name: 'xmlvalid',
		icon: { light: 'file:xmlvalid.svg', dark: 'file:xmlvalid.dark.svg' },
		group: ['transform'],
		version: [1],
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description:
			'Validate XML documents and e-invoices (Peppol, XRechnung, Factur-X, UBL, CII) against XSD, DTD, RelaxNG and Schematron business rules',
		defaults: {
			name: 'xmlvalid',
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		usableAsTool: true,
		credentials: [
			{
				name: 'xmlvalidApi',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Validation', value: 'validation' },
					{ name: 'Account', value: 'account' },
				],
				default: 'validation',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['validation'] } },
				options: [
					{
						name: 'Validate',
						value: 'validate',
						description: 'Validate a document and wait for the result',
						action: 'Validate a document',
					},
					{
						name: 'Get',
						value: 'get',
						description: 'Get a validation, finished or not',
						action: 'Get a validation',
					},
					{
						name: 'Cancel',
						value: 'cancel',
						description: 'Cancel a validation that is still queued or running',
						action: 'Cancel a validation',
					},
					{
						name: 'Share Report',
						value: 'shareReport',
						description: 'Make a public report link for finished validations (Pro)',
						action: 'Share a report link',
					},
				],
				default: 'validate',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['account'] } },
				options: [
					{
						name: 'Get Usage',
						value: 'getUsage',
						description: 'Get the plan, the validations used this month and the limits',
						action: 'Get usage',
					},
					{
						name: 'List Schemas',
						value: 'listSchemas',
						description: 'List your saved schemas and the public catalog',
						action: 'List schemas',
					},
				],
				default: 'getUsage',
			},

			// Validate
			{
				displayName: 'Document Source',
				name: 'source',
				type: 'options',
				displayOptions: { show: { resource: ['validation'], operation: ['validate'] } },
				options: [
					{
						name: 'Binary File',
						value: 'binary',
						description: 'A file from a previous node (XML, gzip, ZIP, Factur-X / ZUGFeRD PDF)',
					},
					{ name: 'URL', value: 'url', description: 'A public http(s) address xmlvalid downloads' },
					{ name: 'Text', value: 'text', description: 'The XML as text' },
				],
				default: 'binary',
			},
			{
				displayName: 'Input Binary Field',
				name: 'binaryPropertyName',
				type: 'string',
				default: 'data',
				required: true,
				displayOptions: { show: { resource: ['validation'], operation: ['validate'], source: ['binary'] } },
				hint: 'The name of the input binary field holding the document',
			},
			{
				displayName: 'URL',
				name: 'url',
				type: 'string',
				default: '',
				required: true,
				placeholder: 'https://example.com/invoice.xml',
				displayOptions: { show: { resource: ['validation'], operation: ['validate'], source: ['url'] } },
			},
			{
				displayName: 'XML',
				name: 'xml',
				type: 'string',
				typeOptions: { rows: 8 },
				default: '',
				required: true,
				displayOptions: { show: { resource: ['validation'], operation: ['validate'], source: ['text'] } },
			},
			{
				displayName: 'Schema Name or ID',
				name: 'schema',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getSchemas' },
				default: 'auto',
				description:
					'Auto-detect picks the catalog profile an e-invoice names (Peppol BIS, XRechnung, Factur-X…) and otherwise checks well-formedness and the DOCTYPE. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
				displayOptions: { show: { resource: ['validation'], operation: ['validate'] } },
			},
			{
				displayName: 'Simplify',
				name: 'simplify',
				type: 'boolean',
				default: true,
				description:
					'Whether to return only the verdict and the findings instead of the full API response',
				displayOptions: { show: { resource: ['validation'], operation: ['validate', 'get'] } },
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add option',
				default: {},
				displayOptions: { show: { resource: ['validation'], operation: ['validate'] } },
				options: [
					{
						displayName: 'File Name',
						name: 'fileName',
						type: 'string',
						default: '',
						description:
							'Shown in your validation history when you keep file names. Defaults to the binary file name.',
					},
					{
						displayName: 'Rules Version',
						name: 'rulesVersion',
						type: 'string',
						default: '',
						placeholder: 'peppol-bis-3-ubl@3.0.21',
						description:
							'Pin the business rules to the releases your workflow was checked against, as rule-set@version, separated by commas. When one has moved to another release, the node fails instead of returning findings of rules that changed. List Schemas shows each schema\'s rule_sets.',
					},
					{
						displayName: 'Timeout (Minutes)',
						name: 'timeout',
						type: 'number',
						typeOptions: { minValue: 1, maxValue: 60 },
						default: 15,
						description: 'How long to wait for the result before cancelling the validation',
					},
					{
						displayName: 'Wait for Result',
						name: 'waitForResult',
						type: 'boolean',
						default: true,
						description:
							'Whether to wait until the validation finishes. Off: return it queued, and fetch it later with Get.',
					},
				],
			},

			// Get, Cancel
			{
				displayName: 'Validation ID',
				name: 'validationId',
				type: 'string',
				default: '',
				required: true,
				placeholder: 'val_01jbz6k8q3m2v7x9c4t5r0w1ya',
				displayOptions: { show: { resource: ['validation'], operation: ['get', 'cancel'] } },
			},

			// Share Report
			{
				displayName: 'Validation IDs',
				name: 'validationIds',
				type: 'string',
				default: '',
				required: true,
				placeholder: 'val_01…, val_01…',
				description: 'Finished validations, separated by commas; the report has every document in them',
				displayOptions: { show: { resource: ['validation'], operation: ['shareReport'] } },
			},
		],
	};

	methods = {
		loadOptions: {
			async getSchemas(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const { body } = await api.call(this, 'GET', '/schemas');
				const list = (key: string, prefix: string) =>
					((body[key] ?? []) as IDataObject[]).map((s) => ({
						name: `${prefix}${String(s.name)}`,
						value: String(s.schema),
						description: String(s.schema),
					}));

				return [
					{ name: 'Auto-Detect', value: 'auto', description: 'The e-invoice profile the document names' },
					...list('saved', 'Saved: '),
					...list('catalog', ''),
				];
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			try {
				const resource = this.getNodeParameter('resource', i) as string;
				const operation = this.getNodeParameter('operation', i) as string;
				let json: IDataObject;

				if (resource === 'account') {
					json = (await api.call(this, 'GET', operation === 'listSchemas' ? '/schemas' : '/usage')).body;
				} else if (operation === 'validate') {
					json = await validate.call(this, i);
				} else if (operation === 'shareReport') {
					const ids = (this.getNodeParameter('validationIds', i) as string)
						.split(',')
						.map((id) => id.trim())
						.filter((id) => id !== '');
					if (ids.length === 0) {
						throw new NodeOperationError(this.getNode(), 'Add at least one validation ID', { itemIndex: i });
					}
					json = (await api.call(this, 'POST', '/reports', { body: { validations: ids } })).body;
				} else {
					const id = encodeURIComponent((this.getNodeParameter('validationId', i) as string).trim());
					json = (await api.call(this, operation === 'cancel' ? 'DELETE' : 'GET', `/validations/${id}`)).body;
					if (operation === 'get' && this.getNodeParameter('simplify', i, true)) {
						json = simplify(json);
					}
				}

				returnData.push({ json, pairedItem: { item: i } });
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({ json: { error: (error as Error).message }, pairedItem: { item: i } });
					continue;
				}
				if (error instanceof NodeApiError) {
					throw new NodeApiError(this.getNode(), error.errorResponse ?? {}, {
						itemIndex: i,
						message: error.message,
						description: error.description ?? undefined,
						httpCode: error.httpCode ?? undefined,
					});
				}
				throw new NodeOperationError(this.getNode(), error as Error, { itemIndex: i });
			}
		}

		return [returnData];
	}
}

async function validate(this: IExecuteFunctions, i: number): Promise<IDataObject> {
	const source = this.getNodeParameter('source', i) as string;
	const schema = (this.getNodeParameter('schema', i, 'auto') as string) || 'auto';
	const options = this.getNodeParameter('options', i, {}) as {
		fileName?: string;
		rulesVersion?: string;
		timeout?: number;
		waitForResult?: boolean;
	};
	const waitForResult = options.waitForResult ?? true;
	const wait = waitForResult ? 60 : 0;
	// The API takes several pins comma-separated, in the query and in JSON alike.
	const pins = (options.rulesVersion ?? '')
		.split(',')
		.map((pin) => pin.trim())
		.filter((pin) => pin !== '')
		.join(',');
	const pinned = pins !== '' ? { rules_version: pins } : {};

	let response: { status: number; body: IDataObject };
	if (source === 'url') {
		const url = (this.getNodeParameter('url', i) as string).trim();
		response = await api.call(this, 'POST', '/validations', { body: { url, schema, wait, ...pinned } });
	} else {
		let document: Buffer;
		let name = options.fileName;
		if (source === 'binary') {
			const field = this.getNodeParameter('binaryPropertyName', i) as string;
			const binary = this.helpers.assertBinaryData(i, field);
			document = await this.helpers.getBinaryDataBuffer(i, field);
			name = name || binary.fileName;
		} else {
			document = Buffer.from(this.getNodeParameter('xml', i) as string, 'utf8');
		}
		if (document.length === 0) {
			throw new NodeOperationError(this.getNode(), 'The document is empty', { itemIndex: i });
		}
		response = await api.call(this, 'POST', '/validations', {
			body: document,
			qs: { schema, wait, ...pinned, ...(name ? { name } : {}) },
			contentType: source === 'text' ? 'application/xml' : 'application/octet-stream',
		});
	}

	let validation = response.body;
	const deadline = Date.now() + (options.timeout ?? 15) * 60_000;
	while (waitForResult && !FINISHED.includes(String(validation.status))) {
		if (Date.now() > deadline) {
			await api.call(this, 'DELETE', `/validations/${String(validation.id)}`).catch(() => undefined);
			throw new NodeOperationError(
				this.getNode(),
				`The validation did not finish within ${options.timeout ?? 15} minutes and was cancelled`,
				{ itemIndex: i },
			);
		}
		await sleep(2000);
		validation = (await api.call(this, 'GET', `/validations/${String(validation.id)}`)).body;
	}

	return this.getNodeParameter('simplify', i, true) ? simplify(validation) : validation;
}
