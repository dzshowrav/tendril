export type KeyContext = 'global' | 'panel' | 'monitor' | 'review';

export interface KeyBindingAction {
  id: string;
  name: string;
  description: string;
  defaultKeys: string[];
  context: KeyContext;
}
