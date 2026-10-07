const fs = require('fs');
const css = fs.readFileSync('dist/style.css', 'utf8');
const goodCss = css.substring(0, css.indexOf('a { color: #60a5fa !important; }') + 32);

const addedCss = `

/* Tùy chỉnh thanh cuộn (Scrollbar) cao cấp cho Dark Mode */
::-webkit-scrollbar {
  width: 10px;
  height: 10px;
}
::-webkit-scrollbar-track {
  background: rgba(255, 255, 255, 0.05);
  border-radius: 8px;
}
::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.2);
  border-radius: 8px;
  backdrop-filter: blur(10px);
}
::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.4);
}

/* Hiệu ứng khối khí mượt mà như Heat-map */
.smooth-mass {
  filter: blur(12px);
}
`;

fs.writeFileSync('dist/style.css', goodCss + addedCss, 'utf8');
console.log('Fixed style.css');
