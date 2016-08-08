var accounts;
var account;
var balance;

var currentRCaddr;
var currentRC;
var paymentAllowed;

var factory = RightsContractFactory.deployed();

function initRightsContract() {
    var name = document.getElementById("newRightsContract").value;
    var addr;

    //this event listens for new creation
    factory.RightsContractCreated().watch(function(err, result) {
    if (err) {
        console.log(err);
        return;
    }
    console.log("contract creation event detected");
    console.log("Addr:");
    addr = result.args._addr;
    console.log(addr);
    setRightsContract(name, addr);
    currentRC.setPermission(account, {from: account, gas: 999000}).then(
        function() {
            console.log("permission set");
        }).catch(function(e) {
            console.log(e);
    });
});
    factory.initiateContract(name, account, {from: account, gas: 3111123}).then(
	       function(value) {
            //var m = RightsContractFactory.at(RightsContractFactory.deployed().address);
			setStatus("RightsContract created");
            console.log(value);
        }).catch(function(e) {
		console.log(e);
		setStatus("Error creating RightsContract ");
		});
};

function setRightsContract(name, addr) {
    currentRCaddr = addr;
    var RC_name = document.getElementById("RightsContractAddr");
    var RC_addr = document.getElementById("RightsContractName");
    RC_name.innerHTML = name.valueOf();
    RC_addr.innerHTML = addr.valueOf();
    currentRC = RightsContract.at(currentRCaddr);
};

function selectRightsContract() {
	var name = document.getElementById("selectRC").value;
    factory.showContractAddr.call(name, {from: account}).then(function(value) {
        setRightsContract(name, value);
    }).catch(function(e) {
        console.log(e);
        setStatus("Error selecting rights contract");
    });
};

function addParty() {
	var addr = document.getElementById("newPartyAddr").value;
	var name = document.getElementById("newPartyName").value;;
	var role = document.getElementById("newPartyRole").value;;
	var rightsSplit = document.getElementById("newPartySplit").value;;

    console.log(addr, name, role, rightsSplit);
	currentRC.makeParty(addr, name, role, rightsSplit, {from: account, gas:3111123}).then(
			function() {
                //this is the contract event
                currentRC.PartyAdd().watch(function(err, result) {
                    if (err) {
                        console.log(err);
                        return;
                    }
                    console.log("party change detected");
                    console.log(res);
                });
			}).catch(function(e) {
					console.log(e);
					setStatus("Error adding parties");
	});
};

function removeParty() {
    //Add prompt to make sure!
    var addr = document.getElementById("removePartyAddr").value;
    currentRC.removeParty(addr, {from: account}).then(
        function() {
            currentRC.PartyAdd().watch(function(err, result) {
                if (err) {
                    console.log(err);
                    return;
                }
                console.log("party change detected");
                console.log(res);
            });
        }).catch(function(e) {
            console.log(e);
            setStatus("Error removing parties");
        });
};

function allowPayments() {
    //TODO: ADD function to set PC in html, and in global scope
    currentRC.unlockPayments({from: account}).then(
        function() {
            paymentAllowed = true;
            setStatus("Payments Now Allowed");
        }).catch(function(e) {
            console.log(e);
            setStatus("Error unlocking payments");
        });
};

function setNewMeta() {
    currentRC.setMetaHash({from: account}).then(
        function() {
            //TODO: add parameter to specify which rights contract to listen to for new PC's
            currentRC.MetaUpdate().watch(function(err, result) {
                if (err) {
                    console.log(err);
                    return;
                }
                console.log("new metadata selected")
                console.log(res);
            })
        }).catch(function(e) {
            console.log(e);
            setStatus("Error selecting metadata");
        });
};

function acceptContract() {
    currentRC.acceptTerms({from: account}).then(
        function() {
            console.log("contract accepted");
        }).catch(function(e) {
            console.log(e);
            console.log("error in accepting contract")
        });
};

function createMetaProposal() {
    var newProposal = document.getElementById("newProposal").value;
    currentRC.createProposal(newProposal, {from: account}).then(
        function() {
            console.log("proposal created");
    }).catch(function(e) {
        console.log(e);
        console.log("error in metaproposal creation");
    });
};

function voteForMetaProposal() {
    var addr = document.getElementById("voteAddr").value;
    currentRC.vote(addr, {from: account}).then(
        function() {
            console.log("vote successful");
        }).catch(function(e) {
            console.log(e);
            console.log("voting error");
        });
};

function checkUserBalance() {
    var bal;
    currentRC.checkBalance.call({from: account}).then(function(value) {
        console.log("User Balance retrieved");
        bal = value;
        document.getElementById("balanceCheck").innerHTML = bal;
    }).catch(function(e) {
        console.log(e);
        console.log("error in checking user balance");
    });
};

function withdraw() {
    currentRC.withdrawBalance({from: account}).then(function(){
        console.log("Funds withdrawn");
    }).catch(function(e) {
        console.log(e);
        console.log("error withdrawing funds");
    });
};


function updateContractState() {
    var c = document.getElementById("contractState");
    console.log(RightsContractFactory.deployed().add);
    c.innerHTML = "RightsContractFactory addr: " + RightsContractFactory.deployed().address.valueOf() + "<br>";
    c.innerHTML += "RightsContract addr: " + currentRC.address + "<br>";

    var num;
    currentRC.showNumberPartyAddresses.call({from: account}).then(function(value) {num = value;});
    c.innerHTML += "Number of parties: " + num.valueOf() + "<br>";

    var metadataHash;
    currentRC.showMetaHash.call({from: account}).then(function(value) {metadataHash = value;});
    c.innerHTML += "IPFS Hash: " + metadataHash.valueOf() + "<br>";
    c.innerHTML += "Direct link to IPFS gateway: https://gateway.ipfs.io/ipfs/" + metadataHash.valueOf() +"<br>";


}



function setStatus(message) {
  var status = document.getElementById("status");
  status.innerHTML = message;
};

window.onload = function() {
  web3.eth.getAccounts(function(err, accs) {
    if (err != null) {
      alert("There was an error fetching your accounts.");
      return;
    }

    if (accs.length == 0) {
      alert("Couldn't get any accounts! Make sure your Ethereum client is configured correctly.");
      return;
    }

    accounts = accs;
    account = accounts[0];
  });
  }
