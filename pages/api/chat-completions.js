import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';
import https from 'https';

const httpsAgent = new https.Agent({ rejectUnauthorized: false });

const CONFIG = {
  API_BASE: process.env.API_BASE || 'https://api.ximagine.io/aimodels/api/v1',
  ORIGIN_URL: process.env.ORIGIN_URL || 'https://ximagine.io',
  DEFAULT_MODEL: 'grok-video-normal',
  MAX_PROMPT_LENGTH: 1800,
  MODEL_MAP: {
    'grok-video-normal': { type: 'video', mode: 'normal', channel: 'GROK_IMAGINE', pageId: 901, name: 'Standard Realistic' },
    'grok-video-fun': { type: 'video', mode: 'fun', channel: 'GROK_IMAGINE', pageId: 901, name: 'Fun Cartoon' },
    'grok-video-spicy': { type: 'video', mode: 'spicy', channel: 'GROK_IMAGINE', pageId: 901, name: 'Spicy Mode' },
    'grok-video-image': { type: 'video', mode: 'normal', channel: 'GROK_IMAGINE', pageId: 901, name: 'Image to Video' },
    'grok-image': { type: 'image', mode: 'normal', channel: 'GROK_TEXT_IMAGE', pageId: 901, name: 'Text to Image' }
  },
  RATIO_MAP: {
    '1:1': '1:1',
    '16:9': '16:9',
    '9:16': '2:3'
  }
};

function generateIdentity() {
  const getPart = () => Math.floor(Math.random() * 254) + 1;
  const ip = `${getPart()}.${getPart()}.${getPart()}.${getPart()}`;
  const major = Math.floor(Math.random() * (132 - 128 + 1) + 128);
  const build = Math.floor(Math.random() * (7000 - 6000 + 1) + 6000);
  const ua = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.${build}.0 Safari/537.36`;
  const secChUa = `"Google Chrome";v="${major}", "Chromium";v="${major}", "Not_A Brand";v="24"`;
  return { ip, ua, secChUa };
}

function getHeaders(uniqueId = null) {
  const ident = generateIdentity();
  const uid = uniqueId || uuidv4().replace(/-/g, '');
  return {
    'Accept': '*/*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Origin': CONFIG.ORIGIN_URL,
    'Referer': `${CONFIG.ORIGIN_URL}/`,
    'User-Agent': ident.ua,
    'uniqueid': uid,
    'X-Forwarded-For': ident.ip,
    'X-Real-IP': ident.ip,
    'sec-ch-ua': ident.secChUa,
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
  };
}

function buildPayload(prompt, modelConfig, aspectRatio, imageUrls) {
  const apiRatio = CONFIG.RATIO_MAP[aspectRatio] || aspectRatio;
  const payload = {
    prompt: prompt,
    channel: modelConfig.channel,
    pageId: modelConfig.pageId,
    source: 'ximagine.io',
    watermarkFlag: true,
    removeWatermark: true,
    private: false,
    privateFlag: false,
    isTemp: true,
    model: 'grok-imagine',
    videoType: 'text-to-video',
    aspectRatio: apiRatio,
    imageUrls: []
  };
  
  if (modelConfig.type === 'video') {
    payload.mode = modelConfig.mode;
    if (imageUrls && imageUrls.length > 0) {
      payload.videoType = 'image-to-video';
      payload.imageUrls = imageUrls;
    }
  }
  
  return payload;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  const body = req.body;
  const messages = body.messages || [];
  
  let prompt = '';
  let imageUrls = [];
  let aspectRatio = '1:1';
  
  const lastContent = messages[messages.length - 1].content;
  
  if (typeof lastContent === 'string') {
    try {
      if (lastContent.trim().startsWith('{')) {
        const parsed = JSON.parse(lastContent);
        prompt = parsed.prompt || '';
        imageUrls = parsed.imageUrls || [];
        aspectRatio = parsed.aspectRatio || '1:1';
        if (parsed.model && CONFIG.MODEL_MAP[parsed.model]) {
          body.model = parsed.model;
        }
      } else {
        prompt = lastContent;
      }
    } catch (e) {
      prompt = lastContent;
    }
  } else if (Array.isArray(lastContent)) {
    for (const part of lastContent) {
      if (part.type === 'text') prompt += part.text;
      if (part.type === 'image_url') imageUrls.push(part.image_url.url);
    }
  }
  
  if (!prompt) {
    return res.status(400).json({ error: 'Prompt is required' });
  }
  
  if (prompt.length > CONFIG.MAX_PROMPT_LENGTH) {
    return res.status(400).json({ error: `Prompt exceeds ${CONFIG.MAX_PROMPT_LENGTH} characters` });
  }
  
  let modelKey = body.model || CONFIG.DEFAULT_MODEL;
  if (!CONFIG.MODEL_MAP[modelKey]) modelKey = CONFIG.DEFAULT_MODEL;
  if (imageUrls.length > 0) modelKey = 'grok-video-image';
  
  const modelConfig = CONFIG.MODEL_MAP[modelKey];
  const uniqueId = uuidv4().replace(/-/g, '');
  
  console.log(`[Request] model=${modelKey} | ratio=${aspectRatio} | prompt=${prompt.substring(0, 60)}...`);
  
  try {
    const headers = getHeaders(uniqueId);
    const payload = buildPayload(prompt, modelConfig, aspectRatio, imageUrls);
    const endpoint = modelConfig.type === 'video' 
      ? `${CONFIG.API_BASE}/ai/video/create`
      : `${CONFIG.API_BASE}/ai/grok/create`;
    
    const response = await axios.post(endpoint, payload, { 
      headers, 
      timeout: 30000,
      httpsAgent
    });
    const responseData = response.data;
    
    if (responseData.code !== 200) {
      throw new Error(`Upstream rejected: ${JSON.stringify(responseData)}`);
    }
    
    const taskId = responseData.data;
    
    return res.json({
      taskId: taskId,
      uniqueId: uniqueId,
      model: modelKey,
      type: modelConfig.type,
      prompt: prompt,
      aspectRatio: aspectRatio
    });
    
  } catch (error) {
    console.error(`[Generation error] ${error.message}`);
    return res.status(500).json({ error: error.message });
  }
}
