import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { RouterProvider } from './router'
import { WalletProvider } from './hooks/useWallet'
import { ElectrumProvider } from './hooks/useElectrum'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider>
      <ElectrumProvider>
        <WalletProvider>
          <App />
        </WalletProvider>
      </ElectrumProvider>
    </RouterProvider>
  </StrictMode>,
)
