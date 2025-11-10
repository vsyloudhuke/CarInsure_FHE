import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';
import { ethers } from 'ethers';

interface InsurancePolicy {
  id: number;
  name: string;
  drivingData: string;
  premium: string;
  timestamp: number;
  creator: string;
  publicValue1: number;
  publicValue2: number;
  isVerified?: boolean;
  decryptedValue?: number;
  encryptedValueHandle?: string;
}

interface InsuranceAnalysis {
  safetyScore: number;
  premiumDiscount: number;
  riskLevel: number;
  drivingBehavior: number;
  potentialSavings: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [policies, setPolicies] = useState<InsurancePolicy[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingPolicy, setCreatingPolicy] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending" as const, 
    message: "" 
  });
  const [newPolicyData, setNewPolicyData] = useState({ name: "", drivingData: "", mileage: "" });
  const [selectedPolicy, setSelectedPolicy] = useState<InsurancePolicy | null>(null);
  const [decryptedData, setDecryptedData] = useState<{ drivingData: number | null; mileage: number | null }>({ drivingData: null, mileage: null });
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [userHistory, setUserHistory] = useState<any[]>([]);
  const [showStats, setShowStats] = useState(false);

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting} = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected) return;
      if (isInitialized) return;
      if (fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadData();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const loadData = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const policiesList: InsurancePolicy[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          policiesList.push({
            id: parseInt(businessId.replace('policy-', '')) || Date.now(),
            name: businessData.name,
            drivingData: businessId,
            premium: businessId,
            timestamp: Number(businessData.timestamp),
            creator: businessData.creator,
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0,
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0
          });
        } catch (e) {
          console.error('Error loading business data:', e);
        }
      }
      
      setPolicies(policiesList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const createPolicy = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingPolicy(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating policy with Zama FHE..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const drivingValue = parseInt(newPolicyData.drivingData) || 0;
      const businessId = `policy-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, drivingValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newPolicyData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        parseInt(newPolicyData.mileage) || 0,
        0,
        "Vehicle Insurance Policy"
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction confirmation..." });
      await tx.wait();
      
      setUserHistory(prev => [...prev, {
        type: 'create',
        policyId: businessId,
        timestamp: Date.now(),
        data: newPolicyData
      }]);
      
      setTransactionStatus({ visible: true, status: "success", message: "Policy created successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowCreateModal(false);
      setNewPolicyData({ name: "", drivingData: "", mileage: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected by user" 
        : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingPolicy(false); 
    }
  };

  const decryptData = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    setIsDecrypting(true);
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Data already verified on-chain" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying decryption on-chain..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      setUserHistory(prev => [...prev, {
        type: 'decrypt',
        policyId: businessId,
        timestamp: Date.now(),
        value: clearValue
      }]);
      
      await loadData();
      
      setTransactionStatus({ visible: true, status: "success", message: "Data decrypted and verified successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Data is already verified on-chain" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        
        await loadData();
        return null;
      }
      
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "Decryption failed: " + (e.message || "Unknown error") 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const analyzePolicy = (policy: InsurancePolicy, decryptedDriving: number | null, decryptedMileage: number | null): InsuranceAnalysis => {
    const drivingScore = policy.isVerified ? (policy.decryptedValue || 0) : (decryptedDriving || policy.publicValue1 || 5);
    const mileage = policy.publicValue1 || 1000;
    
    const baseSafety = Math.min(100, Math.round((drivingScore * 0.7 + (10000 - Math.min(mileage, 10000)) * 0.3) / 100));
    const safetyScore = Math.round(baseSafety * 100);
    
    const premiumDiscount = Math.min(50, Math.round(drivingScore * 0.5 + (100 - mileage / 100) * 0.2));
    const riskLevel = Math.max(10, Math.min(90, 100 - drivingScore * 0.8));
    
    const drivingBehavior = Math.round(drivingScore * 0.9 + (100 - riskLevel) * 0.1);
    const potentialSavings = Math.min(2000, Math.round(premiumDiscount * 40));

    return {
      safetyScore,
      premiumDiscount,
      riskLevel,
      drivingBehavior,
      potentialSavings
    };
  };

  const renderDashboard = () => {
    const totalPolicies = policies.length;
    const verifiedPolicies = policies.filter(p => p.isVerified).length;
    const avgMileage = policies.length > 0 
      ? policies.reduce((sum, p) => sum + p.publicValue1, 0) / policies.length 
      : 0;
    
    const recentPolicies = policies.filter(p => 
      Date.now()/1000 - p.timestamp < 60 * 60 * 24 * 7
    ).length;

    return (
      <div className="dashboard-panels">
        <div className="panel metal-panel">
          <h3>Total Policies</h3>
          <div className="stat-value">{totalPolicies}</div>
          <div className="stat-trend">+{recentPolicies} this week</div>
        </div>
        
        <div className="panel metal-panel">
          <h3>Verified Data</h3>
          <div className="stat-value">{verifiedPolicies}/{totalPolicies}</div>
          <div className="stat-trend">FHE Protected</div>
        </div>
        
        <div className="panel metal-panel">
          <h3>Avg Mileage</h3>
          <div className="stat-value">{avgMileage.toFixed(0)} km</div>
          <div className="stat-trend">Encrypted Analysis</div>
        </div>
      </div>
    );
  };

  const renderAnalysisChart = (policy: InsurancePolicy, decryptedDriving: number | null, decryptedMileage: number | null) => {
    const analysis = analyzePolicy(policy, decryptedDriving, decryptedMileage);
    
    return (
      <div className="analysis-chart">
        <div className="chart-row">
          <div className="chart-label">Safety Score</div>
          <div className="chart-bar">
            <div 
              className="bar-fill" 
              style={{ width: `${analysis.safetyScore}%` }}
            >
              <span className="bar-value">{analysis.safetyScore}</span>
            </div>
          </div>
        </div>
        <div className="chart-row">
          <div className="chart-label">Premium Discount</div>
          <div className="chart-bar">
            <div 
              className="bar-fill" 
              style={{ width: `${analysis.premiumDiscount}%` }}
            >
              <span className="bar-value">{analysis.premiumDiscount}%</span>
            </div>
          </div>
        </div>
        <div className="chart-row">
          <div className="chart-label">Risk Level</div>
          <div className="chart-bar">
            <div 
              className="bar-fill risk" 
              style={{ width: `${analysis.riskLevel}%` }}
            >
              <span className="bar-value">{analysis.riskLevel}</span>
            </div>
          </div>
        </div>
        <div className="chart-row">
          <div className="chart-label">Driving Behavior</div>
          <div className="chart-bar">
            <div 
              className="bar-fill" 
              style={{ width: `${analysis.drivingBehavior}%` }}
            >
              <span className="bar-value">{analysis.drivingBehavior}</span>
            </div>
          </div>
        </div>
        <div className="chart-row">
          <div className="chart-label">Potential Savings</div>
          <div className="chart-bar">
            <div 
              className="bar-fill growth" 
              style={{ width: `${Math.min(100, analysis.potentialSavings / 20)}%` }}
            >
              <span className="bar-value">${analysis.potentialSavings}</span>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderUserHistory = () => {
    return (
      <div className="history-panel">
        <h3>User Operation History</h3>
        <div className="history-list">
          {userHistory.slice(-5).map((record, index) => (
            <div key={index} className="history-item">
              <span className="history-type">{record.type === 'create' ? '📝 Created' : '🔓 Decrypted'}</span>
              <span className="history-details">
                {record.type === 'create' ? record.data.name : `Value: ${record.value}`}
              </span>
              <span className="history-time">
                {new Date(record.timestamp).toLocaleTimeString()}
              </span>
            </div>
          ))}
          {userHistory.length === 0 && (
            <div className="no-history">No operations yet</div>
          )}
        </div>
      </div>
    );
  };

  const filteredPolicies = policies.filter(policy =>
    policy.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    policy.creator.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>CarInsure FHE 🔐</h1>
            <p>Confidential Vehicle Insurance</p>
          </div>
          <div className="header-actions">
            <div className="wallet-connect-wrapper">
              <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
            </div>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">🚗</div>
            <h2>Connect Your Wallet to Continue</h2>
            <p>Please connect your wallet to access encrypted vehicle insurance pricing with FHE protection.</p>
            <div className="connection-steps">
              <div className="step">
                <span>1</span>
                <p>Connect your wallet</p>
              </div>
              <div className="step">
                <span>2</span>
                <p>FHE system initialization</p>
              </div>
              <div className="step">
                <span>3</span>
                <p>Start encrypted insurance pricing</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>Initializing FHE Encryption System...</p>
        <p className="loading-note">Securing your driving data</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading encrypted insurance system...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>CarInsure FHE 🔐</h1>
          <p>Privacy-Preserving Vehicle Insurance</p>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-btn"
          >
            + New Policy
          </button>
          <button 
            onClick={() => setShowStats(!showStats)} 
            className="stats-btn"
          >
            {showStats ? 'Hide Stats' : 'Show Stats'}
          </button>
          <div className="wallet-connect-wrapper">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </div>
      </header>
      
      <div className="main-content-container">
        {showStats && (
          <div className="dashboard-section">
            <h2>Insurance Analytics Dashboard</h2>
            {renderDashboard()}
            {renderUserHistory()}
          </div>
        )}
        
        <div className="policies-section">
          <div className="section-header">
            <h2>Insurance Policies</h2>
            <div className="header-actions">
              <div className="search-box">
                <input 
                  type="text"
                  placeholder="Search policies..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
              <button 
                onClick={loadData} 
                className="refresh-btn" 
                disabled={isRefreshing}
              >
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>
          
          <div className="policies-list">
            {filteredPolicies.length === 0 ? (
              <div className="no-policies">
                <p>No insurance policies found</p>
                <button 
                  className="create-btn" 
                  onClick={() => setShowCreateModal(true)}
                >
                  Create First Policy
                </button>
              </div>
            ) : filteredPolicies.map((policy, index) => (
              <div 
                className={`policy-item ${selectedPolicy?.id === policy.id ? "selected" : ""} ${policy.isVerified ? "verified" : ""}`} 
                key={index}
                onClick={() => setSelectedPolicy(policy)}
              >
                <div className="policy-title">{policy.name}</div>
                <div className="policy-meta">
                  <span>Mileage: {policy.publicValue1} km</span>
                  <span>Created: {new Date(policy.timestamp * 1000).toLocaleDateString()}</span>
                </div>
                <div className="policy-status">
                  Status: {policy.isVerified ? "✅ Verified" : "🔓 Ready for Verification"}
                  {policy.isVerified && policy.decryptedValue && (
                    <span className="verified-score">Safety Score: {policy.decryptedValue}</span>
                  )}
                </div>
                <div className="policy-creator">Creator: {policy.creator.substring(0, 6)}...{policy.creator.substring(38)}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
      
      {showCreateModal && (
        <ModalCreatePolicy 
          onSubmit={createPolicy} 
          onClose={() => setShowCreateModal(false)} 
          creating={creatingPolicy} 
          policyData={newPolicyData} 
          setPolicyData={setNewPolicyData}
          isEncrypting={isEncrypting}
        />
      )}
      
      {selectedPolicy && (
        <PolicyDetailModal 
          policy={selectedPolicy} 
          onClose={() => { 
            setSelectedPolicy(null); 
            setDecryptedData({ drivingData: null, mileage: null }); 
          }} 
          decryptedData={decryptedData} 
          setDecryptedData={setDecryptedData} 
          isDecrypting={isDecrypting || fheIsDecrypting} 
          decryptData={() => decryptData(selectedPolicy.drivingData)}
          renderAnalysisChart={renderAnalysisChart}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="fhe-spinner"></div>}
              {transactionStatus.status === "success" && <div className="success-icon">✓</div>}
              {transactionStatus.status === "error" && <div className="error-icon">✗</div>}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
    </div>
  );
};

const ModalCreatePolicy: React.FC<{
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  policyData: any;
  setPolicyData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, creating, policyData, setPolicyData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    if (name === 'drivingData') {
      const intValue = value.replace(/[^\d]/g, '');
      setPolicyData({ ...policyData, [name]: intValue });
    } else {
      setPolicyData({ ...policyData, [name]: value });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="create-policy-modal">
        <div className="modal-header">
          <h2>New Insurance Policy</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <strong>FHE 🔐 Encryption</strong>
            <p>Driving behavior data encrypted with Zama FHE 🔐 (Integer only)</p>
          </div>
          
          <div className="form-group">
            <label>Policy Holder Name *</label>
            <input 
              type="text" 
              name="name" 
              value={policyData.name} 
              onChange={handleChange} 
              placeholder="Enter policy holder name..." 
            />
          </div>
          
          <div className="form-group">
            <label>Driving Safety Score (1-100) *</label>
            <input 
              type="number" 
              name="drivingData" 
              value={policyData.drivingData} 
              onChange={handleChange} 
              placeholder="Enter safety score..." 
              min="1"
              max="100"
            />
            <div className="data-type-label">FHE Encrypted Integer</div>
          </div>
          
          <div className="form-group">
            <label>Annual Mileage (km) *</label>
            <input 
              type="number" 
              min="1" 
              name="mileage" 
              value={policyData.mileage} 
              onChange={handleChange} 
              placeholder="Enter annual mileage..." 
            />
            <div className="data-type-label">Public Data</div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">Cancel</button>
          <button 
            onClick={onSubmit} 
            disabled={creating || isEncrypting || !policyData.name || !policyData.drivingData || !policyData.mileage} 
            className="submit-btn"
          >
            {creating || isEncrypting ? "Encrypting and Creating..." : "Create Policy"}
          </button>
        </div>
      </div>
    </div>
  );
};

const PolicyDetailModal: React.FC<{
  policy: InsurancePolicy;
  onClose: () => void;
  decryptedData: { drivingData: number | null; mileage: number | null };
  setDecryptedData: (value: { drivingData: number | null; mileage: number | null }) => void;
  isDecrypting: boolean;
  decryptData: () => Promise<number | null>;
  renderAnalysisChart: (policy: InsurancePolicy, decryptedDriving: number | null, decryptedMileage: number | null) => JSX.Element;
}> = ({ policy, onClose, decryptedData, setDecryptedData, isDecrypting, decryptData, renderAnalysisChart }) => {
  const handleDecrypt = async () => {
    if (decryptedData.drivingData !== null) { 
      setDecryptedData({ drivingData: null, mileage: null }); 
      return; 
    }
    
    const decrypted = await decryptData();
    if (decrypted !== null) {
      setDecryptedData({ drivingData: decrypted, mileage: decrypted });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="policy-detail-modal">
        <div className="modal-header">
          <h2>Policy Details</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="policy-info">
            <div className="info-item">
              <span>Policy Holder:</span>
              <strong>{policy.name}</strong>
            </div>
            <div className="info-item">
              <span>Creator:</span>
              <strong>{policy.creator.substring(0, 6)}...{policy.creator.substring(38)}</strong>
            </div>
            <div className="info-item">
              <span>Date Created:</span>
              <strong>{new Date(policy.timestamp * 1000).toLocaleDateString()}</strong>
            </div>
            <div className="info-item">
              <span>Annual Mileage:</span>
              <strong>{policy.publicValue1} km</strong>
            </div>
          </div>
          
          <div className="data-section">
            <h3>Encrypted Driving Data</h3>
            
            <div className="data-row">
              <div className="data-label">Safety Score:</div>
              <div className="data-value">
                {policy.isVerified && policy.decryptedValue ? 
                  `${policy.decryptedValue} (On-chain Verified)` : 
                  decryptedData.drivingData !== null ? 
                  `${decryptedData.drivingData} (Locally Decrypted)` : 
                  "🔒 FHE Encrypted Integer"
                }
              </div>
              <button 
                className={`decrypt-btn ${(policy.isVerified || decryptedData.drivingData !== null) ? 'decrypted' : ''}`}
                onClick={handleDecrypt} 
                disabled={isDecrypting}
              >
                {isDecrypting ? (
                  "🔓 Verifying..."
                ) : policy.isVerified ? (
                  "✅ Verified"
                ) : decryptedData.drivingData !== null ? (
                  "🔄 Re-verify"
                ) : (
                  "🔓 Verify Decryption"
                )}
              </button>
            </div>
            
            <div className="fhe-info">
              <div className="fhe-icon">🔐</div>
              <div>
                <strong>FHE 🔐 Privacy Protection</strong>
                <p>Your driving data is encrypted on-chain. No tracking, just privacy-focused premium calculation.</p>
              </div>
            </div>
          </div>
          
          {(policy.isVerified || decryptedData.drivingData !== null) && (
            <div className="analysis-section">
              <h3>Premium Analysis</h3>
              {renderAnalysisChart(
                policy, 
                policy.isVerified ? policy.decryptedValue || null : decryptedData.drivingData, 
                null
              )}
              
              <div className="decrypted-values">
                <div className="value-item">
                  <span>Safety Score:</span>
                  <strong>
                    {policy.isVerified ? 
                      `${policy.decryptedValue} (Verified)` : 
                      `${decryptedData.drivingData} (Decrypted)`
                    }
                  </strong>
                  <span className={`data-badge ${policy.isVerified ? 'verified' : 'local'}`}>
                    {policy.isVerified ? 'Verified' : 'Local'}
                  </span>
                </div>
                <div className="value-item">
                  <span>Annual Mileage:</span>
                  <strong>{policy.publicValue1} km</strong>
                  <span className="data-badge public">Public</span>
                </div>
              </div>
            </div>
          )}
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">Close</button>
          {!policy.isVerified && (
            <button 
              onClick={handleDecrypt} 
              disabled={isDecrypting}
              className="verify-btn"
            >
              {isDecrypting ? "Verifying..." : "Verify on-chain"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;


