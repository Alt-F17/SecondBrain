import sharp from 'sharp';
import { mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, '..', 'public');
const iconsDir = join(publicDir, 'icons');
const splashDir = join(publicDir, 'splash');

// Ensure directories exist
if (!existsSync(iconsDir)) mkdirSync(iconsDir, { recursive: true });
if (!existsSync(splashDir)) mkdirSync(splashDir, { recursive: true });

// Brain icon SVG (same as icon.svg)
const iconSvg = `
<svg width="512" height="512" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#0a0a0a"/>
      <stop offset="100%" style="stop-color:#0f0f0f"/>
    </linearGradient>
    <linearGradient id="brainGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#06b6d4"/>
      <stop offset="100%" style="stop-color:#a855f7"/>
    </linearGradient>
    <filter id="glow">
      <feGaussianBlur stdDeviation="8" result="coloredBlur"/>
      <feMerge>
        <feMergeNode in="coloredBlur"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
  </defs>
  <rect width="512" height="512" rx="96" fill="url(#bgGrad)"/>
  <g transform="translate(96, 96)" filter="url(#glow)">
    <path d="M160 0C100 0 52 35 32 88C12 141 20 200 56 248C44 280 32 320 32 320H128C128 320 120 284 132 252C148 276 172 296 200 308C200 320 200 320 200 320H280C280 320 280 304 276 284C304 268 328 244 344 216C380 188 400 148 400 104C400 48 356 0 296 0C268 0 244 8 224 24C204 8 180 0 160 0Z" 
          fill="url(#brainGrad)" opacity="0.9"/>
    <circle cx="160" cy="120" r="24" fill="rgba(255,255,255,0.3)"/>
    <circle cx="240" cy="100" r="16" fill="rgba(255,255,255,0.2)"/>
    <circle cx="300" cy="140" r="20" fill="rgba(255,255,255,0.25)"/>
    <path d="M120 160 Q160 200 200 180 Q240 160 280 190" 
          stroke="rgba(255,255,255,0.4)" stroke-width="4" fill="none" stroke-linecap="round"/>
    <path d="M140 200 Q180 220 220 200 Q260 180 300 200" 
          stroke="rgba(255,255,255,0.3)" stroke-width="3" fill="none" stroke-linecap="round"/>
  </g>
</svg>`;

// Icon sizes for PWA (including iOS specific sizes)
const iconSizes = [72, 96, 128, 144, 152, 167, 180, 192, 384, 512];

// iOS splash screen sizes
const splashScreens = [
  { width: 2048, height: 2732, name: 'splash-2048x2732' }, // 12.9" iPad Pro
  { width: 1668, height: 2388, name: 'splash-1668x2388' }, // 11" iPad Pro
  { width: 1536, height: 2048, name: 'splash-1536x2048' }, // 9.7" iPad
  { width: 1284, height: 2778, name: 'splash-1284x2778' }, // iPhone 14 Pro Max
  { width: 1170, height: 2532, name: 'splash-1170x2532' }, // iPhone 14 Pro
  { width: 1179, height: 2556, name: 'splash-1179x2556' }, // iPhone 15 Pro
  { width: 1290, height: 2796, name: 'splash-1290x2796' }, // iPhone 15 Pro Max
  { width: 1125, height: 2436, name: 'splash-1125x2436' }, // iPhone X/XS
  { width: 1242, height: 2688, name: 'splash-1242x2688' }, // iPhone XS Max
  { width: 828, height: 1792, name: 'splash-828x1792' },   // iPhone XR
  { width: 750, height: 1334, name: 'splash-750x1334' },   // iPhone 8
  { width: 640, height: 1136, name: 'splash-640x1136' },   // iPhone SE
];

// Generate splash screen SVG
function createSplashSvg(width, height) {
  const iconSize = Math.min(width, height) * 0.25;
  const iconX = (width - iconSize) / 2;
  const iconY = (height - iconSize) / 2 - height * 0.05;
  
  return `
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#080808"/>
      <stop offset="100%" style="stop-color:#0a0a0a"/>
    </linearGradient>
    <linearGradient id="brainGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#06b6d4"/>
      <stop offset="100%" style="stop-color:#a855f7"/>
    </linearGradient>
    <filter id="glow">
      <feGaussianBlur stdDeviation="15" result="coloredBlur"/>
      <feMerge>
        <feMergeNode in="coloredBlur"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#bgGrad)"/>
  <g transform="translate(${iconX}, ${iconY}) scale(${iconSize / 320})" filter="url(#glow)">
    <path d="M160 0C100 0 52 35 32 88C12 141 20 200 56 248C44 280 32 320 32 320H128C128 320 120 284 132 252C148 276 172 296 200 308C200 320 200 320 200 320H280C280 320 280 304 276 284C304 268 328 244 344 216C380 188 400 148 400 104C400 48 356 0 296 0C268 0 244 8 224 24C204 8 180 0 160 0Z" 
          fill="url(#brainGrad)" opacity="0.9"/>
    <circle cx="160" cy="120" r="24" fill="rgba(255,255,255,0.3)"/>
    <circle cx="240" cy="100" r="16" fill="rgba(255,255,255,0.2)"/>
    <circle cx="300" cy="140" r="20" fill="rgba(255,255,255,0.25)"/>
  </g>
  <text x="${width / 2}" y="${iconY + iconSize + height * 0.08}" 
        font-family="system-ui, -apple-system, sans-serif" 
        font-size="${Math.min(width, height) * 0.05}" 
        font-weight="600" fill="white" text-anchor="middle" opacity="0.9">VECTORDB</text>
  <text x="${width / 2}" y="${iconY + iconSize + height * 0.12}" 
        font-family="system-ui, -apple-system, sans-serif" 
        font-size="${Math.min(width, height) * 0.025}" 
        fill="rgba(255,255,255,0.5)" text-anchor="middle">Your Second Brain</text>
</svg>`;
}

async function generateIcons() {
  console.log('🎨 Generating PWA icons...\n');

  // Generate app icons
  for (const size of iconSizes) {
    const outputPath = join(iconsDir, `icon-${size}x${size}.png`);
    await sharp(Buffer.from(iconSvg))
      .resize(size, size)
      .png()
      .toFile(outputPath);
    console.log(`  ✓ Generated icon-${size}x${size}.png`);
  }

  // Generate maskable icon (with padding for adaptive icons)
  const maskableSvg = `
<svg width="512" height="512" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
  <rect width="512" height="512" fill="#080808"/>
  <g transform="translate(80, 80) scale(0.6875)">
    ${iconSvg.match(/<g transform.*?<\/g>/s)?.[0] || ''}
  </g>
</svg>`;
  
  await sharp(Buffer.from(iconSvg))
    .resize(512, 512)
    .png()
    .toFile(join(iconsDir, 'maskable-512x512.png'));
  console.log('  ✓ Generated maskable-512x512.png');

  // Generate favicon
  await sharp(Buffer.from(iconSvg))
    .resize(32, 32)
    .png()
    .toFile(join(publicDir, 'favicon.png'));
  console.log('  ✓ Generated favicon.png');

  console.log('\n🖼️  Generating iOS splash screens...\n');

  // Generate splash screens
  for (const screen of splashScreens) {
    const splashSvg = createSplashSvg(screen.width, screen.height);
    const outputPath = join(splashDir, `${screen.name}.png`);
    await sharp(Buffer.from(splashSvg))
      .resize(screen.width, screen.height)
      .png()
      .toFile(outputPath);
    console.log(`  ✓ Generated ${screen.name}.png`);
  }

  console.log('\n✅ All icons and splash screens generated successfully!');
}

generateIcons().catch(console.error);
