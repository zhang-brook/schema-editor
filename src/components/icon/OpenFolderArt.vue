<template>
  <!-- 首页空状态插画：打开的文件夹 + 表结构示意 -->
  <svg class="open-folder-art" viewBox="0 0 380 300" aria-hidden="true" focusable="false">
    <!-- 柔和投影 -->
    <ellipse cx="190" cy="284" rx="126" ry="12" fill="#e4eaf2" />
    <!-- 背景圆环装饰 -->
    <circle cx="190" cy="150" r="128" fill="#f3f8fe" />
    <circle cx="190" cy="150" r="98" fill="none" stroke="#e4eefb" stroke-width="2" stroke-dasharray="6 10" />
    <!-- 文件夹背面（品牌蓝、略高，营造"打开"层次） -->
    <path
      d="M10 4H4C2.9 4 2 4.9 2 6v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"
      fill="#c9ddf6"
      transform="translate(70 40) scale(10)"
    />
    <!-- 文件夹正面（白色） -->
    <path
      d="M10 4H4C2.9 4 2 4.9 2 6v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"
      fill="#ffffff"
      transform="translate(70 66) scale(10)"
    />
    <!-- 封面上的表结构示意行 -->
    <g stroke-linecap="round" opacity="0.85">
      <rect x="112" y="150" width="52" height="14" rx="7" fill="#3a72c4" opacity="0.85" />
      <line x1="180" y1="157" x2="268" y2="157" stroke="#d3e0f0" stroke-width="6" />
      <line x1="122" y1="184" x2="268" y2="184" stroke="#d3e0f0" stroke-width="6" />
      <line x1="122" y1="212" x2="236" y2="212" stroke="#d3e0f0" stroke-width="6" />
    </g>
    <!-- 右下角浮动装饰：表格卡片 -->
    <g>
      <clipPath id="table-chip-clip">
        <rect x="302" y="172" width="72" height="62" rx="10" />
      </clipPath>
      <g clip-path="url(#table-chip-clip)">
        <rect x="302" y="172" width="72" height="62" fill="#ffffff" />
        <rect x="302" y="172" width="72" height="18" fill="#3a72c4" opacity="0.8" />
      </g>
      <rect x="310" y="204" width="56" height="6" rx="3" fill="#cddcf0" />
      <rect x="310" y="218" width="44" height="6" rx="3" fill="#e2eaf6" />
    </g>
  </svg>
</template>

<style scoped>
.open-folder-art {
  width: 360px;
  max-width: 70vw;
  max-height: 45vh;
}
</style>
