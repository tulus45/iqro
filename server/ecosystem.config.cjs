module.exports = {
  apps: [
    {
      name: 'iqro-api',
      script: './index.js',
      cwd: '/var/www/iqro/server',
      env: {
        NODE_ENV: 'production',
        PORT: 4720,
        HOST: '0.0.0.0'
      }
    }
  ]
};
