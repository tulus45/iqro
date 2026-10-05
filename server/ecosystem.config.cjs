module.exports = {
  apps: [
    {
      name: 'iqro-api',
      instances: 1,
      exec_mode: 'fork',
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
