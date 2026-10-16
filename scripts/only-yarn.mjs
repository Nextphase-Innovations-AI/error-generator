const ua = process.env.npm_config_user_agent ?? '';
if (ua && !ua.startsWith('yarn')) {
  console.error(`This repository is yarn-only; use "yarn install". Detected: ${ua.split(' ')[0]}`);
  process.exit(1);
}
