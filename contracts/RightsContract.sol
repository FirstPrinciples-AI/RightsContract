
contract RightsContract {

    enum Stages {
        Drafted,
        Accepted,
        Published,
        Invalid
    }
    Stages public stage;

    function RightsContract() {
        stage = Stages(0);
        numberpartyAddresses = 0;
    }

    //Modifiers to ensure contract changes can be locked in
    modifier atDrafted {
        if (stage == Stages(0)){
            _
        }
    }

    modifier isValid {
        if (stage != Stages(3)){
            _
        }
    }

    //People who are allowed to make changes to this contract
    mapping (address => bool) public Permission;

    //Iterating through this allows us to check splitTotal
    address[] partyAddresses;

    //Once all partyAddresses accept, move in to Accepted stage
    uint numberpartyAddresses;
    uint numberAccepted;

    //total must be <= 100 in Drafted stage, and exactly 100 to move forward
    uint splitTotal;

    //The meta data;
    string ipfsHash;

    //Structure for person involved in contract
    struct Party {
        string name;
        string role;
        uint rightsSplit; //splits should be moved into payment contract!
        bool accepts;
    }

    //every address in partAddresses maps to a Party
    mapping (address => Party) Participants;

    //amount owed to each individual party
    mapping (address => uint) balance;

    //For metadata:
    mapping (address => string) public proposals;

    mapping (address => address) public votes;


    modifier hasPermission {
        if (Permission[msg.sender]){
            _
        }
    }

    function checkPermission(address addr) public constant returns(bool retVal){
        return Permission[addr];
    }

    function setPermission(address addr){
        Permission[addr] = true;
    }

    function checkStage() public constant returns (uint retVal){
        for (uint i = 0; i < 4; i++){
            if (Stages(i) == stage){
                return i;
            }
        }
    }

    //Fails if splitTotal goes over 100
    function makeParty(address _addr, string _name, string _role, uint _rightsSplit) hasPermission atDrafted {
        if (!(splitTotal + _rightsSplit <= 100)) {
            throw;
        }
        Party memory p = Party(
            _name,
            _role,
            _rightsSplit,
            false
            );
        Participants[_addr] = p;
        Permission[_addr] = true;
        partyAddresses.push(_addr);
        splitTotal += _rightsSplit;
        numberpartyAddresses += 1;
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
    }

    function checkSplit() public constant returns (bool retVal){
        uint sum;
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

    function createProposal(string _proposal) hasPermission {
        //If anyone has voted for your proposal(other than yourself), throw.
        for (uint i = 0; i < numberpartyAddresses; i++){
            if (votes[partyAddresses[i]] == msg.sender && partyAddresses[i] != msg.sender){
                throw;
                }
            }
        proposals[msg.sender] = _proposal;
    }

    function getProposal(address addr) constant returns (string _proposal){
        return proposals[addr];
    }

    function vote(address addr) hasPermission {
        votes[msg.sender] = addr;
    }

    function setMetaHash() hasPermission isValid {
        if (!checkVotes()){
            throw;
        }
        ipfsHash = proposals[votes[partyAddresses[0]]];
        stage = Stages(2);
    }

    function checkVotes() public constant returns (bool retVal){
        address addr = votes[partyAddresses[0]];
        for (uint i = 0; i < numberpartyAddresses; i++){
            if (addr != partyAddresses[i]) {
                return false;
            }
        }
        return true;
    }

    //Payments:
    bool paymentsUnlocked;

    function unlockPayments() hasPermission atDrafted isValid{
        stage = Stages(1);
    }

    function showPaymentsUnlocked() public constant returns(bool retVal){
        return paymentsUnlocked;
    }

    event Payment (address indexed sender, string indexed from, string indexed  purpose);

    function sendPayment(string _from, string _purpose) {
        uint total = msg.value;
        for (uint i = 0; i < numberpartyAddresses; i++){
            address p = partyAddresses[i];
            uint owed = total / Participants[p].rightsSplit;
            balance[p] += owed;
            total += owed;
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

    //Stops advancement of contract. Indicates some real world communication will be needed. (Code isn't the law here)
    function claimInvalid() hasPermission{
        stage = Stages(3);
        paymentsUnlocked = false;
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

    function showPartyName(uint i) public constant returns(string _name){
        return Participants[partyAddresses[i]].name;
    }

    function showPartyRole(uint i) public constant returns(string _role){
        return Participants[partyAddresses[i]].role;
    }

    function showPartySplit(uint i) public constant returns(uint _split){
        return Participants[partyAddresses[i]].rightsSplit;
    }

    function showPartyAccept(uint i) public constant returns(bool _accepts){
        return Participants[partyAddresses[i]].accepts;
    }
}
