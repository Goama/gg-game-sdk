/**
 * Global type definitions for window.GGSDK
 */

import { GGSDK } from './index';

declare global {
  interface Window {
    GGSDK: GGSDK;
  }
}

export {};