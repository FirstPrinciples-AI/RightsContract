contract MakeContract { //needs better name (?)
    address public creator;

    //Still considering different options for naming contracts.
    //OR JUST USE CONTRACT ADDRESS
    mapping (bytes32 => address) public contracts;

    function MakeContract() {
        creator = msg.sender;
    }

    event RightsContractCreated(bytes32 indexed _name, address indexed _addr);

    function initiateContract(bytes32 name) {
        //Names cannot be overwritten. Instead, they must be deleted first.

        //TODO: test this if-statement
        if (contracts[name] == 0x0){
            throw;
        }
        address c = new RightsContract();
        contracts[name] = c;
        RightsContractCreated(name, c);
    }

    function showContractAddr(bytes32 _name) public constant returns(address retVal){
        return contracts[_name];
    }

    function removeContract(bytes32 name){
        address cAddr = contracts[name];
        if (cAddr == 0x0){
            throw;
        }
        RightsContract c = RightsContract(cAddr);
        //Check if c is invalid
        if (c.checkStage() == 3){
            if (c.checkPermission(msg.sender) || (msg.sender == creator)) {
                //Delete contract data inside?
                //c.delete()

                //not sure how this behaves exactly
                //contracts[name] = "" 0x0 0 might be better
                delete contracts[name];
            }
        }
    }

    function remove() {
        if (msg.sender == creator) {
            suicide(creator);
        }
    }
}


/* What other "higher-level" functionality would be useful?
Changing contract name? (or should it be voted on?)
*/

contract RightsContract {
    //There's probably a better term than "invalid"
    enum Stages {
        Drafted,
        Accepted,
        Published,
        Invalid
    }
    Stages public stage;

    //Modifiers to ensure contract changes can be locked in
    modifier atDrafted {
        if (stage == Stages(0)){
            _
        }
    }
    modifier atAccepted {
        if (stage == Stages(1)){
            _
        }
    }
    modifier atPublished {
        if (stage == Stages(2)){
            _
        }
    }
    modifier isValid {
        if (stage != Stages(3)){
            _
        }
    }
    modifier isInvalid {
        if (stage == Stages(3)){
            _
        }
    }

    //People who are allowed to make changes to this contract
    mapping (address => bool) Permission;

    //Iterating through this allows us to check splitTotal
    address[] partyAddresses;

    //Once all partyAddresses accept, move in to Accepted stage
    uint numberpartyAddresses;
    uint numberAccepted;

    //total must be <= 100 in Drafted stage, and exactly 100 to move forward
    uint8 splitTotal;

    //PaymentContract for this particular instance of RightsContract
    address paymentContract;

    //Where voting on canonical meta data occurs
    address metaVoteContract;

//The meta data;
    string ipfsHash;

    //Structure for person involved in contract
    struct Party {
        string name;
        string role;
        uint8 rightsSplit; //splits should be moved into payment contract!
        bool accepts;
    }

/*
    mapping (address => string) Roles;
    mapping (address => ) OwnershipSplit; //values inside ALWAYS adds up to 100. only ints allowed.
    //sum checked on creation, and upon any changes.
    //addresses in mappping MUST be in one of the address arrays
    mapping (address => bool) Accepts;
*/
    mapping (address => Party) Participants;


    modifier hasPermission {
        if (Permission[msg.sender]){
            _
        }
    }

    function checkPermission(address addr) public constant returns(bool retVal){
        return Permission[addr];
    }

    function RightsContract() {
        Permission[msg.sender] = true;
        stage = Stages(0);
    }

    function checkStage() public constant returns (uint retVal){
        for (uint i = 0; i < 4; i++){
            if (Stages(i) == stage){
                return i;
            }
        }
    }

    //Adds a Party to contract. (JS will loop through all individuals needed and call this function for each one)

    //bool = true if added, false if removed
    event PartyAdd(address addr, bool added);

    function makeParty(address _addr, string _name, string _role, uint8 _rightsSplit) hasPermission atDrafted {
        if (!(splitTotal + _rightsSplit <= 100)) {
            throw;
        }
        Participants[_addr] = Party(
            _name,
            _role,
            _rightsSplit,
            false
            );
        Permission[_addr] = true;
        partyAddresses.push(_addr);
        splitTotal += _rightsSplit;
        PartyAdd(_addr, true);
    }

    function removeParty(address _addr) hasPermission atDrafted{
        //Not the most efficient method, will rethink later
        if (!Permission[_addr] || partyAddresses.length == 0){
            throw; //party already deleted
        }
        uint arrLength = partyAddresses.length;
        delete Permission[_addr];
        delete Participants [_addr];

        //causes cap of 100 for participants which shouldn't matter, but is stupid design. 'integer literal is needed for array length'
        address[100] memory temp;

        for (uint i = 0; i < arrLength; i++){
            if (Permission[partyAddresses[i]]){
                temp[i] = partyAddresses[i];
            }
        }
        for (uint j = 0; j < arrLength; j++){
            partyAddresses.push(temp[j]);
        }

        delete partyAddresses;
        partyAddresses = temp;
        PartyAdd(_addr, false);
    }

    function checkSplit() public constant returns (bool retVal){
        uint8 sum;
        for (uint i = 0; i < partyAddresses.length; i++){
            sum += Participants[partyAddresses[i]].rightsSplit;
        }
        if (sum == 100){
            return true;
        } else {
            return false;
        }

    }

    //If all partyAddresses have accepted, move to Accepted, and allow for PaymentContract creation
    function acceptTerms() hasPermission atDrafted {
        if (!checkSplit()){
            throw;
        }
        numberAccepted++;
        uint s = numberpartyAddresses - numberAccepted;
        if (s == 0) {
            stage = Stages(1);
        }
    }

    event PaymentContractCreated(address indexed addr);

    function createPaymentContract() hasPermission atAccepted { //locks OwnershipSplit, uses proportions for payouts
        if (paymentContract != 0x0) {
            address c = new PaymentContract();
            paymentContract = c;
            PaymentContract(c).setRightsContract(this);
            PaymentContractCreated(c);
        }
    }

    event MetaVoteContractCreated(address indexed addr);

    function createMetaVoteContract() hasPermission atAccepted returns (address retVal) { //locks OwnershipSplit, uses proportions for payouts
        if (paymentContract != 0x0) {
            address c = new MetaVote();
            metaVoteContract = c;
            MetaVote(c).setRightsContract(this);
            MetaVoteContractCreated(c);
        }
    }

     //Rework permissions for this?
    function setMetaHash(string _ipfsHash) hasPermission isValid {
        ipfsHash = _ipfsHash;
    }


    //Stops advancement of contract. Indicates some real world communication will be needed. (Code isn't the law here)
    function claimInvalid() hasPermission returns (bool retVal) {
        stage = Stages(3);
        return true;
    }

    //Below are contant functions for displaying contract info:
    function showMetaHash() public constant returns(string retVal) {
        return ipfsHash;
    }

    function showNumberPartyAddresses() public constant returns(uint retVal) {
        return numberpartyAddresses;
    }

    function showAddrs(uint i) public constant returns(address retVal) {
        return partyAddresses[i];
    }

    function showParty(uint i) public constant returns(string _name, string _role, uint8 _split, bool _accepts) {
        //I think this has to be more than one function (uint uint uint ) returns are possible, prob not with different types though.
        //does this work:
        //showName(); showRole(); showSplit(); showAccepts(); all
    }

    //why we need syntactic sugar in Solidity:
    function showStage() public constant returns(string _stage) {
        uint s = checkStage();
        if (s == 0){
            return "Drafted";
        } else if (s == 1){
            return "Accepted";
        } else if (s == 2){
            return "Published";
        } else if (s == 3){
            return "Invalid";
        }
    }

    function showPaymentsAddr() public constant returns(address retVal) {
        return paymentContract;
    }

    function showMetaAddr() public constant returns(address retVal) {
        return metaVoteContract;
    }
}
/*
SubContracts belong to particular instances of RightsContracts. Currently includes PaymentContract and MetaVote contracts. SubContracts should have access to splits, permissions, etc. from the main RightsContract
*/
contract SubContract {

    address public rightsContractAddr;

    //Might have to move this to actual subcontract?
    //Still unsure of how correct the linter is
    modifier hasPermission {
        RightsContract c = RightsContract(rightsContractAddr);
        if (c.checkPermission(msg.sender)){
            _
        }
    }

    //To be done only once
    function setRightsContract(address addr) {
        if (rightsContractAddr != 0x0){
            rightsContractAddr = addr;
        }

    }

    function SubContract() {

    }
}

/*
This contract belongs to a specific instance of any RightsContract. It handles the creation of new metadata, and let's participants agree on a proposal.
*/
contract MetaVote is SubContract{
    //Permissions will be used from the RightsContract

    /*Each individual with permission can have a proposal up in the form of the hash of an IPFS object, which will be the JSON file for metadata. Other filetypes can be supported since it's just an IPFS hash. (yml, JSON-LD, IPLD, etc. should be looked into)
    */
    mapping (address => string) public proposals;

    //Each user only gets one vote,
    mapping (address => address) public votes;


    function MetaVote() {

    }

    event ProposalAdded(address indexed addr, string indexed prop);

    //user submits IPFS hash for their proposal
    function createProposal(string _proposal) hasPermission {
        proposals[msg.sender] = _proposal;
        ProposalAdded(msg.sender, _proposal);
    }

    function getProposal(address addr) constant returns (string _proposal){
        return proposals[addr];
    }

    /* On voting:
    It's assumed there is some level of trust between participants, or that they have some way of deciding rights outside of this contract (e.g. a lawyer). The contract simply codifies the consensus on truth (hopefully).
    */

    //User votes on someone's propoal (can be their own).
    event VoteAdded(address indexed _addr, address indexed vote);

    function vote(address addr) hasPermission {
        votes[msg.sender] = addr;
        VoteAdded(msg.sender, addr);
    }

    //If all partyAddresses have voted unanimously returns true,
    function checkVotes() public constant returns (bool retVal){
        RightsContract c = RightsContract(rightsContractAddr);
        address addr = votes[0];
        for (uint i = 0; i < c.showNumberPartyAddresses(); i++){
            if (addr != c.showAddrs(i)){
                return false;
            }
        }
        return true;
    }

    event MetaUpdate(string indexed _prop);
    //Sends new hash upto RighstContract. Should be stored server-side as well.
    function publishMetaData() {
        RightsContract c = RightsContract(rightsContractAddr);
        if (!checkVotes()){
            throw;
        }
        string newMeta = proposals[c.showAddrs(0)];
        c.setMetaHash(newMeta);
        MetaUpdate(newMeta);
    }
}

contract PaymentContract is SubContract {
    event Payment (address indexed sender, string indexed from, string indexed  purpose);

    //amount owed to each individual party
    mapping (address => uint) balance;

    //proportion out of 10,000 that each user gets
    mapping (address => uint) split;


    //"actual total" balance of ether stored in contract

    function PaymentContract() {
        //set rights contract address probably
    }


    function () {
        //OOG errors are likely esp. because of storage costs for retrieving and resetting balances. Use sendPayment to supply more gas.
        throw;
    }

    function sendPayment(string _from, string _purpose) {
        RightsContract c = RightsContract(rightsContractAddr);
        //to have information with payments stored in some kind of DB. TODO: decide on a data structure
        //TODO: Make this safer. Integer division here is definitely flawed.
        uint total = msg.value;
        for (uint i = 0; i < c.showNumberPartyAddresses(); i++){
            address p = c.showAddrs(i);
            uint owed = total * split[p];
            balance[p] += owed;
            total -= owed;
        }
        Payment(msg.sender, _from, _purpose);
    }

    function checkBalance() constant returns (uint retVal) {
        return balance[msg.sender];
    }

    function withdrawBalance() hasPermission {
        uint currentBalance = balance[msg.sender];
        balance[msg.sender] = 0;
        if (!msg.sender.send(currentBalance)) {
            throw;
        }
    }
}
