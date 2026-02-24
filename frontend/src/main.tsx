import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { WalletProvider } from './hooks/useWallet'
import { ElectrumProvider } from './hooks/useElectrum'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ElectrumProvider>
      <WalletProvider>
        <App />
      </WalletProvider>
    </ElectrumProvider>
  </StrictMode>,
)
