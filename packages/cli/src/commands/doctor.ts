/**
 * Terminal UI & Diagnostic Doctor.
 * Follows Kiro CLI Terminal UI specification (new-ins.md § 14, § 20).
 *
 * Checks:
 * - Terminal capabilities (color depth, truecolor, synchronized output, hyperlinks)
 * - Active opt-out environment variables
 * - Theme compatibility and fallback status
 * - Practical recommendations for rendering issues
 */

import { detectTerminalCapabilities } from '../capabilities/detector.js';
import { ENV_VARS } from '../config/constants.js';
import { resolveActiveTheme } from '../theme/loader.js';

export interface DoctorCheck {
  name: string;
  status: 'ok' | 'warn' | 'fail';
  detail: string;
  recommendation?: string;
}

export function runUIDoctor(): { checks: DoctorCheck[]; recommendations: string[] } {
  const caps = detectTerminalCapabilities();
  const theme = resolveActiveTheme();
  const checks: DoctorCheck[] = [];
  const recommendations: string[] = [];

  // 1. Color support
  if (caps.colorDepth === 'truecolor') {
    checks.push({
      name: 'Color Support',
      status: 'ok',
      detail: '24-bit Truecolor detected',
    });
  } else if (caps.colorDepth === '256' || caps.colorDepth === '16') {
    checks.push({
      name: 'Color Support',
      status: 'ok',
      detail: `${caps.colorDepth}-color palette detected`,
    });
  } else {
    checks.push({
      name: 'Color Support',
      status: 'warn',
      detail: 'Monochrome or color disabled',
      recommendation: 'Use safe theme or check terminal color settings',
    });
  }

  // 2. Synchronized Output (Mode 2026)
  if (caps.synchronizedOutput) {
    checks.push({
      name: 'Synchronized Output',
      status: 'ok',
      detail: 'Mode 2026 atomic rendering supported (prevents flicker)',
    });
  } else {
    checks.push({
      name: 'Synchronized Output',
      status: 'warn',
      detail: 'Not supported by terminal; standard stream rendering active',
      recommendation: 'Set TENDRIL_NO_SYNCHRONIZED=1 if you notice tearing',
    });
    recommendations.push('If rendering flickers during streaming, disable synchronized output: export TENDRIL_NO_SYNCHRONIZED=1');
  }

  // 3. Clickable Hyperlinks (OSC 8)
  if (caps.hyperlinks) {
    checks.push({
      name: 'Terminal Hyperlinks',
      status: 'ok',
      detail: 'OSC 8 clickable links supported',
    });
  } else {
    checks.push({
      name: 'Terminal Hyperlinks',
      status: 'ok',
      detail: 'Fallback to visible plain text URLs',
    });
  }

  // 4. Opt-Out Environment Variables
  const activeOptOuts: string[] = [];
  if (process.env[ENV_VARS.NO_COLOR]) activeOptOuts.push(ENV_VARS.NO_COLOR);
  if (process.env[ENV_VARS.TENDRIL_NO_SYNCHRONIZED]) activeOptOuts.push(ENV_VARS.TENDRIL_NO_SYNCHRONIZED);
  if (process.env[ENV_VARS.TENDRIL_NO_HYPERLINKS]) activeOptOuts.push(ENV_VARS.TENDRIL_NO_HYPERLINKS);
  if (process.env[ENV_VARS.TENDRIL_NO_PROGRESS]) activeOptOuts.push(ENV_VARS.TENDRIL_NO_PROGRESS);
  if (process.env[ENV_VARS.TENDRIL_ASCII_MODE]) activeOptOuts.push(ENV_VARS.TENDRIL_ASCII_MODE);

  checks.push({
    name: 'Opt-Out Variables',
    status: 'ok',
    detail: activeOptOuts.length > 0 ? `Active: ${activeOptOuts.join(', ')}` : 'None active (standard defaults)',
  });

  // 5. Active Theme
  checks.push({
    name: 'Active Theme',
    status: 'ok',
    detail: `Using '${theme.name}' theme (NO_COLOR: ${theme.isNoColor})`,
  });

  if (recommendations.length === 0) {
    recommendations.push('Terminal capabilities are optimal for Tendril Terminal UI.');
  }

  return { checks, recommendations };
}

export function formatDoctorReport(
  report: { checks: DoctorCheck[]; recommendations: string[] },
  theme = resolveActiveTheme(),
): string {
  const { colors } = theme;
  const lines: string[] = [];

  lines.push(colors.bold(colors.textPrimary('Tendril Terminal Capability Doctor (§ 20):')));
  lines.push('');

  for (const c of report.checks) {
    const icon =
      c.status === 'ok'
        ? colors.textSuccess('✔')
        : c.status === 'warn'
          ? colors.textWarning('⚠')
          : colors.textError('✖');

    lines.push(`  ${icon} ${colors.bold(c.name)}: ${colors.textMuted(c.detail)}`);
    if (c.recommendation) {
      lines.push(`     ${colors.textAccent(`↳ Recommendation: ${c.recommendation}`)}`);
    }
  }

  lines.push('');
  lines.push(colors.bold(colors.textPrimary('Troubleshooting Advice:')));
  for (const r of report.recommendations) {
    lines.push(`  • ${colors.textMuted(r)}`);
  }

  return lines.join('\n');
}
