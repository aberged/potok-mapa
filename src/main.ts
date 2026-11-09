import { mountMap } from './app';

if (import.meta.env.DEV) {
  const { seedDevMap } = await import('./dev-tools');
  const { installDevPotok } = await import('./potok-dev');
  seedDevMap();
  installDevPotok();
}

// No top-level await below this point: the build wrapper (vite.config.ts) runs
// this code inside a plain function.

mountMap(document.querySelector<HTMLElement>('#map-app')!);
