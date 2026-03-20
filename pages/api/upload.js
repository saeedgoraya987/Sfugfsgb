import formidable from 'formidable';
import fs from 'fs';
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
    const form = formidable({});
    const [fields, files] = await form.parse(req);
    const file = files.file?.[0];
    
    if (!file) {
      return res.status(400).json({ success: false, error: 'No file uploaded' });
    }

    const fileBuffer = fs.readFileSync(file.filepath);
    const filename = file.originalFilename || 'image.jpg';

    // Use ImgBB for uploads (simpler for Vercel)
    if (CONFIG.IMGBB_API_KEY) {
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
          // Clean up temp file
          fs.unlinkSync(file.filepath);
          
          return res.json({
            success: true,
            data: { url: response.data.data.url },
            code: 200,
          });
        }
      } catch (imgbbErr) {
        console.error('ImgBB upload failed:', imgbbErr.message);
      }
    }

    // Clean up temp file
    if (file.filepath && fs.existsSync(file.filepath)) {
      fs.unlinkSync(file.filepath);
    }

    return res.status(500).json({
      success: false,
      error: 'Upload failed. Please set IMGBB_API_KEY in environment variables.',
    });
  } catch (error) {
    console.error('Upload error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}
