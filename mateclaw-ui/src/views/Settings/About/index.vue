<template>
  <div class="about-page">
    <!-- Hero: Logo + Identity -->
    <section class="hero">
      <img src="/logo/mateclaw_logo_s.png" alt="OpenClawMax" class="hero-logo" />
      <div class="hero-copy">
        <h1 class="hero-title">OpenClaw<span class="hero-accent">Max</span></h1>
        <div class="hero-version">v{{ appVersion }}</div>
        <p class="hero-desc">{{ t('settings.about.heroDesc') }}</p>
      </div>
    </section>

    <!-- Three pillars — that's all you need to know -->
    <section class="pillars">
      <div v-for="(pillar, i) in pillars" :key="i" class="pillar">
        <div class="pillar-num">{{ String(i + 1).padStart(2, '0') }}</div>
        <h3 class="pillar-title">{{ pillar.title }}</h3>
        <p class="pillar-desc">{{ pillar.desc }}</p>
      </div>
    </section>

    <!-- Tech stack — clean and honest -->
    <section class="stack">
      <h3 class="stack-heading">{{ t('settings.about.foundationTitle') }}</h3>
      <div class="stack-grid">
        <div v-for="tech in techStack" :key="tech.name" class="stack-item">
          <el-icon class="stack-icon"><component :is="tech.icon" /></el-icon>
          <span class="stack-name">{{ tech.name }}</span>
          <span class="stack-ver">{{ tech.version }}</span>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, markRaw } from 'vue'
import { useI18n } from 'vue-i18n'
import { Coffee, Cpu, Promotion, Monitor, Lightning, Coin } from '@element-plus/icons-vue'
import { version as appVersion } from '../../../../package.json'

const { t } = useI18n()

const pillars = computed(() => [
  {
    title: t('settings.about.pillars.contextTitle'),
    desc: t('settings.about.pillars.contextDesc'),
  },
  {
    title: t('settings.about.pillars.executionTitle'),
    desc: t('settings.about.pillars.executionDesc'),
  },
  {
    title: t('settings.about.pillars.memoryTitle'),
    desc: t('settings.about.pillars.memoryDesc'),
  },
])

const techStack = [
  { icon: markRaw(Coffee), name: 'Spring Boot', version: '3.3' },
  { icon: markRaw(Cpu), name: 'Spring AI', version: '1.1' },
  { icon: markRaw(Promotion), name: 'Spring AI Alibaba', version: '1.1' },
  { icon: markRaw(Monitor), name: 'Vue 3', version: '3.5' },
  { icon: markRaw(Lightning), name: 'Vite', version: '7' },
  { icon: markRaw(Coin), name: 'MyBatis Plus', version: '3.5' },
]
</script>

<style scoped>
.about-page {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

/* ===== Hero ===== */
.hero {
  display: flex;
  align-items: center;
  gap: 24px;
  padding: 28px;
  background: var(--mc-bg-elevated);
  border: 1px solid var(--mc-border);
  border-radius: 16px;
}

.hero-logo {
  width: 80px;
  height: 80px;
  object-fit: contain;
  flex-shrink: 0;
}

.hero-copy {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.hero-title {
  font-size: 28px;
  font-weight: 800;
  color: var(--mc-text-primary);
  margin: 0;
  letter-spacing: -0.03em;
}

.hero-accent { color: var(--mc-primary); }

.hero-version {
  font-size: 12px;
  font-weight: 600;
  color: var(--mc-text-tertiary);
  letter-spacing: 0.04em;
}

.hero-desc {
  margin: 6px 0 0;
  font-size: 14px;
  line-height: 1.6;
  color: var(--mc-text-secondary);
}

/* ===== Pillars ===== */
.pillars {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 14px;
}

.pillar {
  padding: 20px;
  background: var(--mc-bg-elevated);
  border: 1px solid var(--mc-border);
  border-radius: 14px;
}

.pillar-num {
  font-size: 11px;
  font-weight: 700;
  color: var(--mc-primary);
  letter-spacing: 0.1em;
}

.pillar-title {
  margin: 10px 0 0;
  font-size: 15px;
  font-weight: 700;
  color: var(--mc-text-primary);
}

.pillar-desc {
  margin: 6px 0 0;
  font-size: 13px;
  line-height: 1.6;
  color: var(--mc-text-secondary);
}

/* ===== Tech Stack ===== */
.stack {
  padding: 24px;
  background: var(--mc-bg-elevated);
  border: 1px solid var(--mc-border);
  border-radius: 14px;
}

.stack-heading {
  font-size: 15px;
  font-weight: 700;
  color: var(--mc-text-primary);
  margin: 0 0 16px;
}

.stack-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
}

.stack-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-radius: 10px;
  background: var(--mc-bg-sunken);
}

.stack-icon { font-size: 16px; flex-shrink: 0; color: var(--mc-primary); }
.stack-name { font-size: 13px; font-weight: 600; color: var(--mc-text-primary); }
.stack-ver { font-size: 12px; color: var(--mc-text-tertiary); margin-left: auto; }

/* ===== Responsive ===== */
@media (max-width: 760px) {
  .hero { flex-direction: column; text-align: center; }
  .pillars, .stack-grid { grid-template-columns: 1fr; }
}
</style>
