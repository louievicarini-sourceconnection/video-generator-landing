const { getPool } = require('./_lib/db');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  const videoId = parseInt(req.query.video_id, 10);
  if (!videoId) {
    return res.status(400).json({ error: 'video_id is required.' });
  }

  try {
    const pool = getPool();
    const result = await pool.query(
      `SELECT id, status, video_url, duration_seconds, occasion FROM videos WHERE id = $1`,
      [videoId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'No video found for that id.' });
    }

    const video = result.rows[0];
    return res.status(200).json({
      id: video.id,
      status: video.status,
      video_url: video.status === 'complete' ? video.video_url : null,
      duration_seconds: video.duration_seconds,
      occasion: video.occasion,
    });
  } catch (err) {
    console.error('get-video failed:', err);
    return res.status(500).json({ error: 'Failed to look up video.' });
  }
};
