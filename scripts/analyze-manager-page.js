const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 }
  });
  const page = await context.newPage();

  try {
    console.log('Navigating to manager game page...');
    await page.goto('https://www.soundclash.org/manager/game/TEST123', {
      waitUntil: 'networkidle',
      timeout: 30000
    });

    // Wait a bit for any animations or dynamic content
    await page.waitForTimeout(2000);

    // Take full page screenshot
    console.log('Taking full page screenshot...');
    await page.screenshot({
      path: path.join(__dirname, 'manager-page-full.png'),
      fullPage: true
    });

    // Take viewport screenshot
    console.log('Taking viewport screenshot...');
    await page.screenshot({
      path: path.join(__dirname, 'manager-page-viewport.png'),
      fullPage: false
    });

    // Get page title and basic info
    const title = await page.title();
    console.log('Page Title:', title);

    // Analyze layout structure
    console.log('\n=== Analyzing Page Structure ===');

    // Get main containers
    const mainContainer = await page.evaluate(() => {
      const container = document.querySelector('.manager-console-container') ||
                       document.querySelector('.manager-game-page') ||
                       document.querySelector('main');
      if (!container) return null;

      const styles = window.getComputedStyle(container);
      return {
        className: container.className,
        backgroundColor: styles.backgroundColor,
        padding: styles.padding,
        width: styles.width,
        maxWidth: styles.maxWidth
      };
    });
    console.log('Main Container:', JSON.stringify(mainContainer, null, 2));

    // Analyze buttons
    const buttons = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      return btns.map(btn => {
        const styles = window.getComputedStyle(btn);
        return {
          text: btn.textContent?.trim().substring(0, 30),
          className: btn.className,
          backgroundColor: styles.backgroundColor,
          color: styles.color,
          padding: styles.padding,
          fontSize: styles.fontSize,
          borderRadius: styles.borderRadius,
          border: styles.border,
          display: styles.display,
          width: styles.width
        };
      });
    });
    console.log('\n=== Buttons Analysis ===');
    buttons.forEach((btn, i) => {
      console.log(`\nButton ${i + 1}:`, JSON.stringify(btn, null, 2));
    });

    // Analyze color scheme
    const colorScheme = await page.evaluate(() => {
      const colors = new Set();
      const allElements = document.querySelectorAll('*');

      allElements.forEach(el => {
        const styles = window.getComputedStyle(el);
        if (styles.backgroundColor && styles.backgroundColor !== 'rgba(0, 0, 0, 0)') {
          colors.add(styles.backgroundColor);
        }
        if (styles.color) {
          colors.add(styles.color);
        }
      });

      return Array.from(colors);
    });
    console.log('\n=== Color Palette ===');
    console.log(colorScheme);

    // Analyze typography
    const typography = await page.evaluate(() => {
      const textElements = Array.from(document.querySelectorAll('h1, h2, h3, h4, p, span, label'));
      return textElements.slice(0, 10).map(el => {
        const styles = window.getComputedStyle(el);
        return {
          tag: el.tagName,
          text: el.textContent?.trim().substring(0, 40),
          fontSize: styles.fontSize,
          fontWeight: styles.fontWeight,
          fontFamily: styles.fontFamily,
          color: styles.color,
          lineHeight: styles.lineHeight
        };
      });
    });
    console.log('\n=== Typography Analysis ===');
    typography.forEach((text, i) => {
      console.log(`\nText Element ${i + 1}:`, JSON.stringify(text, null, 2));
    });

    // Get spacing analysis
    const spacing = await page.evaluate(() => {
      const sections = Array.from(document.querySelectorAll('section, div[class*="section"], div[class*="container"]'));
      return sections.slice(0, 5).map(section => {
        const styles = window.getComputedStyle(section);
        return {
          className: section.className,
          margin: styles.margin,
          padding: styles.padding,
          gap: styles.gap
        };
      });
    });
    console.log('\n=== Spacing Analysis ===');
    spacing.forEach((space, i) => {
      console.log(`\nSection ${i + 1}:`, JSON.stringify(space, null, 2));
    });

    // Analyze specific manager console elements
    const managerElements = await page.evaluate(() => {
      return {
        youtubePlayer: !!document.querySelector('iframe[src*="youtube"]') || !!document.querySelector('[class*="youtube"]'),
        scoreSection: !!document.querySelector('[class*="score"]'),
        controlButtons: document.querySelectorAll('[class*="control"], [class*="button"]').length,
        answerSection: !!document.querySelector('[class*="answer"]'),
        roundInfo: !!document.querySelector('[class*="round"]')
      };
    });
    console.log('\n=== Manager Console Elements ===');
    console.log(JSON.stringify(managerElements, null, 2));

    // Take screenshot of specific sections if they exist
    const sections = await page.$$('[class*="section"], section');
    for (let i = 0; i < Math.min(sections.length, 3); i++) {
      await sections[i].screenshot({
        path: path.join(__dirname, `manager-page-section-${i + 1}.png`)
      });
      console.log(`Screenshot taken for section ${i + 1}`);
    }

    console.log('\n✓ Analysis complete! Screenshots saved to scripts/ directory');

  } catch (error) {
    console.error('Error during analysis:', error);

    // Take error screenshot
    await page.screenshot({
      path: path.join(__dirname, 'manager-page-error.png')
    });
  } finally {
    await browser.close();
  }
})();
