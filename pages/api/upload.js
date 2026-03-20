import busboy from 'busboy';
import axios from 'axios';
import FormData from 'form-data';
import { v4 as uuidv4 } from 'uuid';

export const config = {
  api: {
    bodyParser: false,
  },
};

const CONFIG = {
  IMGBB_API_KEY: process.env.IMGBB_API_KEY || '',
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const bb = busboy({ headers: req.headers });
    let fileBuffer = null;
    let filename = '';
    let contentType = '';

    await new Promise((resolve, reject) => {
      bb.on('file', (name, file, info) => {
        filename = info.filename;
        contentType = info.mimeType;
        const chunks = [];
        
        file.on('data', (data) => {
          chunks.push(data);
        });
        
        file.on('end', () => {
          fileBuffer = Buffer.concat(chunks);
        });
      });
      
      bb.on('error', (err) => {
        reject(err);
      });
      
      bb.on('finish', () => {
        resolve();
      });
      
      req.pipe(bb);
    });

    if (!fileBuffer) {
      return res.status(400).json({ success: false, error: 'No file uploaded' });
    }

    // Use ImgBB for uploads
    if (!CONFIG.IMGBB_API_KEY) {
      return res.status(500).json({ 
        success: false, 
        error: 'IMGBB_API_KEY not configured. Please add it in environment variables.' 
      });
    }

    try {
      const b64Image = fileBuffer.toString('base64');
      const formData = new FormData();
      formData.append('key', CONFIG.IMGBB_API_KEY);
      formData.append('image', b64Image);
      formData.append('name', filename);

      const response = await axios.post('https://api.imgbb.com/1/upload', formData, {
        headers: formData.getHeaders(),
        timeout: 30000,
      });

      if (response.data.success && response.data.data && response.data.data.url) {
        return res.json({
          success: true,
          data: { url: response.data.data.url },
          code: 200,
        });
      } else {
        throw new Error('ImgBB upload failed: ' + JSON.stringify(response.data));
      }
    } catch (uploadErr) {
      console.error('ImgBB upload failed:', uploadErr.message);
      return res.status(500).json({ 
        success: false, 
        error: 'Upload failed: ' + uploadErr.message 
      });
    }
  } catch (error) {
    console.error('Upload error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}
