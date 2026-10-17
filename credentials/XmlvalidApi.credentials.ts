import type {
	IAuthenticateGeneric,
	Icon,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class XmlvalidApi implements ICredentialType {
	name = 'xmlvalidApi';

	displayName = 'Xmlvalid API';

	icon: Icon = { light: 'file:xmlvalid.svg', dark: 'file:xmlvalid.dark.svg' };

	documentationUrl = 'https://github.com/xmlvalid/n8n-nodes-xmlvalid?tab=readme-ov-file#credentials';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description: 'A key from Dashboard → API on xmlvalid.com (starts with xv_)',
		},
		{
			displayName: 'API URL',
			name: 'baseUrl',
			type: 'string',
			default: 'https://xmlvalid.com/api/v1',
			description: 'Change only for a self-hosted xmlvalid',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.apiKey}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.baseUrl}}',
			url: '/usage',
		},
	};
}
