import { KeyBindingAction } from './context.js';

export const BASELINE_ACTIONS: KeyBindingAction[] = [
  // Global
  {
    id: 'global.newline',
    name: 'New Line',
    description: 'Insert newline without sending prompt',
    defaultKeys: ['shift+enter', 'ctrl+j', 'alt+enter'],
    context: 'global',
  },
  {
    id: 'global.toggle_output',
    name: 'Toggle Output',
    description: 'Expand or collapse tool output and reasoning traces',
    defaultKeys: ['ctrl+o'],
    context: 'global',
  },
  {
    id: 'global.toggle_tray',
    name: 'Activity Tray',
    description: 'Toggle quick task progress and queued message overview',
    defaultKeys: ['ctrl+x'],
    context: 'global',
  },
  {
    id: 'global.crew_monitor',
    name: 'Crew Monitor',
    description: 'Open multi-agent crew monitor',
    defaultKeys: ['ctrl+g'],
    context: 'global',
  },
  {
    id: 'global.transcript',
    name: 'Transcript',
    description: 'Open full session transcript in pager',
    defaultKeys: ['ctrl+t'],
    context: 'global',
  },
  {
    id: 'global.reverse_search',
    name: 'Reverse History Search',
    description: 'Search past prompt history interactively',
    defaultKeys: ['ctrl+r'],
    context: 'global',
  },
  {
    id: 'global.plan_mode',
    name: 'Plan Mode',
    description: 'Toggle plan mode',
    defaultKeys: ['shift+tab'],
    context: 'global',
  },
  {
    id: 'global.cancel',
    name: 'Cancel / Dismiss',
    description: 'Close active overlay, abort running turn, or clear queue',
    defaultKeys: ['escape'],
    context: 'global',
  },
  {
    id: 'global.exit',
    name: 'Exit',
    description: 'Exit Tendril CLI',
    defaultKeys: ['ctrl+c', 'ctrl+d'],
    context: 'global',
  },

  // Panel Context
  {
    id: 'panel.close',
    name: 'Close Panel',
    description: 'Close active overlay panel',
    defaultKeys: ['escape', 'q'],
    context: 'panel',
  },
  {
    id: 'panel.select',
    name: 'Select Item',
    description: 'Select current active item in panel',
    defaultKeys: ['enter'],
    context: 'panel',
  },

  // Monitor Context
  {
    id: 'monitor.stop_arm',
    name: 'Arm Stop',
    description: 'Two-step arm stop command (press twice to confirm stop)',
    defaultKeys: ['ctrl+x'],
    context: 'monitor',
  },
  {
    id: 'monitor.subagent_prev',
    name: 'Previous Subagent',
    description: 'Navigate to previous subagent in monitor',
    defaultKeys: ['ctrl+u'],
    context: 'monitor',
  },
  {
    id: 'monitor.subagent_next',
    name: 'Next Subagent',
    description: 'Navigate to next subagent in monitor',
    defaultKeys: ['ctrl+d'],
    context: 'monitor',
  },
  {
    id: 'monitor.close',
    name: 'Close Monitor',
    description: 'Close monitor view and return to chat',
    defaultKeys: ['escape', 'q'],
    context: 'monitor',
  },

  // Review Context
  {
    id: 'review.scroll_half_up',
    name: 'Scroll Half Page Up',
    description: 'Scroll document half page up',
    defaultKeys: ['ctrl+u', 'pageup'],
    context: 'review',
  },
  {
    id: 'review.scroll_half_down',
    name: 'Scroll Half Page Down',
    description: 'Scroll document half page down',
    defaultKeys: ['ctrl+d', 'pagedown'],
    context: 'review',
  },
  {
    id: 'review.add_comment',
    name: 'Stage Comment',
    description: 'Stage review comment at current line',
    defaultKeys: ['enter', 'e'],
    context: 'review',
  },
  {
    id: 'review.delete_comment',
    name: 'Delete Comment',
    description: 'Delete staged comment at line',
    defaultKeys: ['delete'],
    context: 'review',
  },
  {
    id: 'review.help',
    name: 'Review Shortcuts',
    description: 'Show review screen keyboard shortcuts',
    defaultKeys: ['?'],
    context: 'review',
  },
  {
    id: 'review.close',
    name: 'Close Review',
    description: 'Return to checkpoint or chat',
    defaultKeys: ['escape', 'q'],
    context: 'review',
  },
];
