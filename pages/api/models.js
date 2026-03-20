const MODEL_MAP = {
  'grok-video-normal': { type: 'video', mode: 'normal', channel: 'GROK_IMAGINE', pageId: 901, name: 'Standard Realistic' },
  'grok-video-fun': { type: 'video', mode: 'fun', channel: 'GROK_IMAGINE', pageId: 901, name: 'Fun Cartoon' },
  'grok-video-spicy': { type: 'video', mode: 'spicy', channel: 'GROK_IMAGINE', pageId: 901, name: 'Spicy Mode' },
  'grok-video-image': { type: 'video', mode: 'normal', channel: 'GROK_IMAGINE', pageId: 901, name: 'Image to Video' },
  'grok-image': { type: 'image', mode: 'normal', channel: 'GROK_TEXT_IMAGE', pageId: 901, name: 'Text to Image' }
};

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  const models = Object.entries(MODEL_MAP).map(([id, config]) => ({
    id: id,
    object: 'model',
    created: Math.floor(Date.now() / 1000),
    owned_by: 'ximagine',
    name: config.name,
    type: config.type
  }));
  
  return res.json({ object: 'list', data: models });
}
