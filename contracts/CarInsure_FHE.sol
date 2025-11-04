pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract CarInsureFHE is ZamaEthereumConfig {
    struct Policy {
        string policyId;
        euint32 encryptedScore;
        uint256 basePremium;
        uint256 publicFactor;
        string vehicleInfo;
        address owner;
        uint256 creationTime;
        uint32 decryptedScore;
        bool isDecrypted;
    }

    mapping(string => Policy) public policies;
    string[] public policyIds;

    event PolicyCreated(string indexed policyId, address indexed owner);
    event ScoreDecrypted(string indexed policyId, uint32 score);

    constructor() ZamaEthereumConfig() {}

    function createPolicy(
        string calldata policyId,
        externalEuint32 encryptedScore,
        bytes calldata scoreProof,
        uint256 basePremium,
        uint256 publicFactor,
        string calldata vehicleInfo
    ) external {
        require(bytes(policies[policyId].policyId).length == 0, "Policy exists");
        require(FHE.isInitialized(FHE.fromExternal(encryptedScore, scoreProof)), "Invalid encryption");

        policies[policyId] = Policy({
            policyId: policyId,
            encryptedScore: FHE.fromExternal(encryptedScore, scoreProof),
            basePremium: basePremium,
            publicFactor: publicFactor,
            vehicleInfo: vehicleInfo,
            owner: msg.sender,
            creationTime: block.timestamp,
            decryptedScore: 0,
            isDecrypted: false
        });

        FHE.allowThis(policies[policyId].encryptedScore);
        FHE.makePubliclyDecryptable(policies[policyId].encryptedScore);
        policyIds.push(policyId);

        emit PolicyCreated(policyId, msg.sender);
    }

    function decryptScore(
        string calldata policyId,
        bytes memory abiEncodedScore,
        bytes memory decryptionProof
    ) external {
        require(bytes(policies[policyId].policyId).length > 0, "Policy not found");
        require(!policies[policyId].isDecrypted, "Already decrypted");

        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(policies[policyId].encryptedScore);

        FHE.checkSignatures(cts, abiEncodedScore, decryptionProof);

        uint32 score = abi.decode(abiEncodedScore, (uint32));
        policies[policyId].decryptedScore = score;
        policies[policyId].isDecrypted = true;

        emit ScoreDecrypted(policyId, score);
    }

    function calculatePremium(string calldata policyId) external view returns (uint256) {
        require(bytes(policies[policyId].policyId).length > 0, "Policy not found");
        require(policies[policyId].isDecrypted, "Score not decrypted");

        Policy storage policy = policies[policyId];
        uint256 discountFactor = 100 - policy.decryptedScore;
        return (policy.basePremium * discountFactor) / 100 + policy.publicFactor;
    }

    function getPolicyDetails(string calldata policyId) external view returns (
        string memory vehicleInfo,
        address owner,
        uint256 creationTime,
        uint32 decryptedScore,
        bool isDecrypted
    ) {
        require(bytes(policies[policyId].policyId).length > 0, "Policy not found");
        Policy storage policy = policies[policyId];

        return (
            policy.vehicleInfo,
            policy.owner,
            policy.creationTime,
            policy.decryptedScore,
            policy.isDecrypted
        );
    }

    function getAllPolicyIds() external view returns (string[] memory) {
        return policyIds;
    }

    function getEncryptedScore(string calldata policyId) external view returns (euint32) {
        require(bytes(policies[policyId].policyId).length > 0, "Policy not found");
        return policies[policyId].encryptedScore;
    }

    function contractAvailable() public pure returns (bool) {
        return true;
    }
}


