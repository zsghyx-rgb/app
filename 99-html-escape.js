// @file js/99-html-escape.js
// _escHtml HTML 转义工具(被多处渲染函数使用)。

function _escHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
