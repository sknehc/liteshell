import axios from 'axios';

const api = axios.create({ baseURL: '/api' });

export async function getConfig() {
    const res = await api.get('/config');
    return res.data.config;
}

export async function saveConfig(config: any) {
    await api.post('/config', { config });
}

export async function saveConfigKey(key: string, value: any) {
    await api.post(`/config/${key}`, { value });
}