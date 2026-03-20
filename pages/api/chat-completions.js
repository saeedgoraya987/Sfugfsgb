import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';
import https from 'https';

const axiosInstance = axios.create({
  httpsAgent: new https.Agent({ rejectUnauthorized: false })
});

const CONFIG = {
  API_BASE: process.env.API_BASE || 'https://api.ximagine.io/aimodels/api/v1',
  ORIGIN_URL: process.env.ORIGIN_URL || 'https://ximagine.io',
  DEFAULT_MODEL: 'grok-video-normal',
  MAX_PROMPT_LENGTH: 1800,
  MAX_POLL_TIME: 120,
  POLL_INTERVAL: 2,
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
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-site',
    'priority': 'u=1, i'
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
  let clientPollMode = false;
  
  const lastContent = messages[messages.length - 1].content;
  
  if (typeof lastContent === 'string') {
    try {
      if (lastContent.trim().startsWith('{')) {
        const parsed = JSON.parse(lastContent);
        prompt = parsed.prompt || '';
        imageUrls = parsed.imageUrls || [];
        aspectRatio = parsed.aspectRatio || '1:1';
        clientPollMode = parsed.clientPollMode || false;
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
  
  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  
  const sendChunk = (content, finishReason = null, isReasoning = false) => {
    const delta = isReasoning ? { reasoning_content: content } : { content: content };
    const chunk = {
      id: `chatcmpl-${uuidv4()}`,
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model: modelKey,
      choices: [{ index: 0, delta: delta, finish_reason: finishReason }]
    };
    return `data: ${JSON.stringify(chunk)}\n\n`;
  };
  
  // Client poll mode
  if (clientPollMode) {
    try {
      const headers = getHeaders(uniqueId);
      const payload = buildPayload(prompt, modelConfig, aspectRatio, imageUrls);
      const endpoint = modelConfig.type === 'video' 
        ? `${CONFIG.API_BASE}/ai/video/create`
        : `${CONFIG.API_BASE}/ai/grok/create`;
      
      const response = await axiosInstance.post(endpoint, payload, { headers, timeout: 30000 });
      const responseData = response.data;
      
      if (responseData.code !== 200) {
        throw new Error(`Upstream rejected: ${JSON.stringify(responseData)}`);
      }
      
      const taskId = responseData.data;
      
      const result = {
        id: `chatcmpl-${uuidv4()}`,
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: modelKey,
        choices: [{
          index: 0,
          delta: {
            content: `\n\n✅ **Task Submitted**\n- TASK_ID: ${taskId}\n- UID: ${uniqueId}\n- TYPE: ${modelConfig.type}\n`
          },
          finish_reason: null
        }]
      };
      
      res.write(`data: ${JSON.stringify(result)}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
      
    } catch (error) {
      console.error(`[Generation error] ${error.message}`);
      res.write(sendChunk(`\n>>> ❌ Error: ${error.message}`));
      res.write('data: [DONE]\n\n');
      res.end();
    }
    return;
  }
  
  // Sync mode
  try {
    res.write(sendChunk('🚀 **Initializing generation task...**\n', null, true));
    
    const headers = getHeaders();
    const payload = buildPayload(prompt, modelConfig, aspectRatio, imageUrls);
    const endpoint = modelConfig.type === 'video' 
      ? `${CONFIG.API_BASE}/ai/video/create`
      : `${CONFIG.API_BASE}/ai/grok/create`;
    
    res.write(sendChunk('📡 Submitting to Ximagine compute cluster...\n', null, true));
    
    const createResponse = await axiosInstance.post(endpoint, payload, { headers, timeout: 30000 });
    const createData = createResponse.data;
    
    if (createData.code !== 200) {
      throw new Error(`Upstream rejected: ${JSON.stringify(createData)}`);
    }
    
    const taskId = createData.data;
    res.write(sendChunk(`✅ Task created (ID: ${taskId})\n`, null, true));
    
    const startTime = Date.now();
    let lastProgress = -1;
    
    while (Date.now() - startTime < CONFIG.MAX_POLL_TIME * 1000) {
      const pollResponse = await axiosInstance.get(
        `${CONFIG.API_BASE}/ai/${taskId}?channel=${modelConfig.channel}`,
        { headers, timeout: 10000 }
      );
      const pollData = pollResponse.data;
      const data = pollData.data || {};
      
      if (data.completeData) {
        const inner = JSON.parse(data.completeData);
        if (inner.code === 200 && inner.data && inner.data.result_urls && inner.data.result_urls.length > 0) {
          const videoUrl = inner.data.result_urls[0];
          const baseUrl = `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers['x-forwarded-host'] || req.headers.host}`;
          const proxyUrl = `${baseUrl}/api/proxy-download?url=${encodeURIComponent(videoUrl)}`;
          
          const resultMarkdown = `
# 🎬 Video Generation Complete

<video src="${proxyUrl}" controls autoplay loop style="width:100%; max-width:800px; border-radius:12px; box-shadow: 0 8px 32px rgba(0,0,0,0.2);"></video>

## 📥 Download Links
- [Download via Proxy](${proxyUrl})
- [Direct Download](${videoUrl})

**Details:**
- Model: \`${modelKey}\`
- Ratio: \`${aspectRatio}\`
`;
          
          res.write(sendChunk(resultMarkdown));
          res.write(sendChunk('', 'stop'));
          break;
        } else {
          throw new Error(`Generation failed: ${JSON.stringify(inner)}`);
        }
      } else if (data.failMsg) {
        throw new Error(`Generation failed: ${data.failMsg}`);
      }
      
      const progress = data.progress || 0;
      if (progress && Math.floor(progress * 100) !== lastProgress) {
        lastProgress = Math.floor(progress * 100);
        const barLen = 20;
        const filled = Math.floor(progress * barLen);
        const bar = '█'.repeat(filled) + '░'.repeat(barLen - filled);
        res.write(sendChunk(`⏳ Rendering: [${bar}] ${lastProgress}%\n`, null, true));
      }
      
      await new Promise(resolve => setTimeout(resolve, CONFIG.POLL_INTERVAL * 1000));
    }
    
    if (Date.now() - startTime >= CONFIG.MAX_POLL_TIME * 1000) {
      throw new Error('Generation timed out');
    }
    
  } catch (error) {
    console.error(`[Generation error] ${error.message}`);
    res.write(sendChunk(`\n>>> ❌ Error: ${error.message}`));
    res.write(sendChunk('', 'stop'));
  }
  
  res.write('data: [DONE]\n\n');
  res.end();
}
