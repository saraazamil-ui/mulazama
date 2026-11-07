import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig(({mode})=>{
 if(mode!=='test')throw Error('ENGINEERING_BUILD_REQUIRES_TEST_MODE');
 return {plugins:[react()],base:'./',server:{host:'127.0.0.1'},build:{outDir:'dist-engineering',rollupOptions:{input:'engineering.html'}}};
});
