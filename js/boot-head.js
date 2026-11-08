// @file js/boot-head.js
// 页面最早执行的辅助脚本：禁用 iOS 双指缩放和双击放大。
// 主题（data-app-theme / data-bs-theme）已改为 index.html <head> 最前面的内联脚本，
// 保证在任何样式和内容渲染前就写好属性，不会出现闪白/闪黑。

document.addEventListener('gesturestart', function(e) { e.preventDefault(); });
document.addEventListener('gesturechange', function(e) { e.preventDefault(); });
document.addEventListener('gestureend', function(e) { e.preventDefault(); });

let lastTouchEnd = 0;
document.addEventListener('touchend', function(event) {
    const now = Date.now();
    if (now - lastTouchEnd <= 300) { event.preventDefault(); }
    lastTouchEnd = now;
}, false);
