import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';
import https from 'https';

const httpsAgent = new https.Agent({ rejectUnauthorized: false });

const CONFIG = {
  API_BASE: process.env.API_BASE || 'https://api.ximagine.io/aimodels/api/v1',
  ORIGIN_URL: process.env.ORIGIN_URL || 'https://ximagine.io',
  AUTH_TOKEN: process.env.AUTH_TOKEN || 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJsb2dpblR5cGUiOiJsb2dpbiIsImxvZ2luSWQiOiJ4aW1hZ2luZS5pby11c2VyLTc2MjkzNCIsInJuU3RyIjoiUE9GbHBJRm1vOTlyalBLd2RRT1pac3hSRkg0NDJJSmcifQ.V8QaTImPoiZe_PyL0bkkHMMNwEltTTPeAhK93QLLKI4',
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
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Authorization': `Bearer ${CONFIG.AUTH_TOKEN}`,
    'Origin': CONFIG.ORIGIN_URL,
    'Referer': `${CONFIG.ORIGIN_URL}/`,
    'User-Agent': ident.ua,
    'uniqueid': uid,
    'X-Forwarded-For': ident.ip,
    'X-Real-IP': ident.ip,
    'sec-ch-ua': ident.secChUa,
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'Content-Type': 'application/json',
  };
}

function buildPayload(prompt, modelConfig, aspectRatio, imageUrls) {
  const apiRatio = CONFIG.RATIO_MAP[aspectRatio] || aspectRatio;
  
  const payload = {
    prompt: prompt,
    channel: modelConfig.channel,
    pageId: modelConfig.pageId,
    source: "ximagine.io",
    watermarkFlag: true,
    removeWatermark: true,
    private: false,
    privateFlag: false,
    isTemp: true,
    model: "grok-imagine",
    aspectRatio: apiRatio,
    imageUrls: imageUrls || []
  };

  if (modelConfig.type === "video") {
    payload.mode = modelConfig.mode;
    payload.videoType = imageUrls && imageUrls.length > 0 ? "image-to-video" : "text-to-video";
  }

  console.log('[PAYLOAD]', JSON.stringify(payload, null, 2));
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
  let aspectRatio = '16:9';
  let clientPollMode = true;
  
  const lastContent = messages[messages.length - 1].content;
  
  if (typeof lastContent === 'string') {
    try {
      if (lastContent.trim().startsWith('{')) {
        const parsed = JSON.parse(lastContent);
        prompt = parsed.prompt || '';
        imageUrls = parsed.imageUrls || [];
        aspectRatio = parsed.aspectRatio || '16:9';
        clientPollMode = parsed.clientPollMode !== false;
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
  console.log(`[Request] imageUrls:`, imageUrls);
  
  try {
    const headers = getHeaders(uniqueId);
    const payload = buildPayload(prompt, modelConfig, aspectRatio, imageUrls);
    
    // Use the correct endpoint
    const endpoint = modelConfig.type === 'video' 
      ? `${CONFIG.API_BASE}/ai/video/create`
      : `${CONFIG.API_BASE}/ai/grok/create`;
    
    console.log(`[Endpoint] ${endpoint}`);
    console.log(`[Headers]`, JSON.stringify(headers, null, 2));
    
    const response = await axios.post(endpoint, payload, { 
      headers, 
      timeout: 30000,
      httpsAgent
    });
    
    console.log(`[Response Status] ${response.status}`);
    console.log(`[Response Data]`, JSON.stringify(response.data, null, 2));
    
    const responseData = response.data;
    
    if (responseData.code === 200 && responseData.data) {
      const taskId = responseData.data;
      
      return res.json({
        success: true,
        taskId: taskId,
        uniqueId: uniqueId,
        model: modelKey,
        type: modelConfig.type,
        prompt: prompt,
        aspectRatio: aspectRatio
      });
    } else {
      throw new Error(`Upstream rejected: ${JSON.stringify(responseData)}`);
    }
    
  } catch (error) {
    console.error(`[Generation error]`, error.response?.data || error.message);
    
    // Return more detailed error
    return res.status(500).json({ 
      error: error.message,
      details: error.response?.data || 'No additional details',
      status: error.response?.status
    });
  }
}
