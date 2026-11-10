import { describe, expect, it } from 'vitest';
import { escAction } from '../assets/scripts/HudChrome';

describe('Esc routing', () => {
  it('map open + Esc: closes the panel, never opens Settings', () => {
    expect(escAction({ settingsOpen: false, panelOpen: true, hasTarget: false })).toBe('panel');
  });
  it('target selected + Esc: left to the combat HUD (clears the target), Settings stays closed', () => {
    expect(escAction({ settingsOpen: false, panelOpen: false, hasTarget: true })).toBe('target');
  });
  it('nothing open + Esc: opens Settings', () => {
    expect(escAction({ settingsOpen: false, panelOpen: false, hasTarget: false })).toBe('open');
  });
  it('Settings open + Esc: closes it first, whatever else is up', () => {
    expect(escAction({ settingsOpen: true, panelOpen: true, hasTarget: true })).toBe('close');
  });
  it('a panel wins over a target', () => {
    expect(escAction({ settingsOpen: false, panelOpen: true, hasTarget: true })).toBe('panel');
  });
});
