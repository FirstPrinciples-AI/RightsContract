var Web3 = require("web3");

(function() {
  // Planned for future features, logging, etc.
  function Provider(provider) {
    this.provider = provider;
  }

  Provider.prototype.send = function() {
    this.provider.send.apply(this.provider, arguments);
  };

  Provider.prototype.sendAsync = function() {
    this.provider.sendAsync.apply(this.provider, arguments);
  };

  var BigNumber = (new Web3()).toBigNumber(0).constructor;

  var Utils = {
    is_object: function(val) {
      return typeof val == "object" && !Array.isArray(val);
    },
    is_big_number: function(val) {
      if (typeof val != "object") return false;

      // Instanceof won't work because we have multiple versions of Web3.
      try {
        new BigNumber(val);
        return true;
      } catch (e) {
        return false;
      }
    },
    merge: function() {
      var merged = {};
      var args = Array.prototype.slice.call(arguments);

      for (var i = 0; i < args.length; i++) {
        var object = args[i];
        var keys = Object.keys(object);
        for (var j = 0; j < keys.length; j++) {
          var key = keys[j];
          var value = object[key];
          merged[key] = value;
        }
      }

      return merged;
    },
    promisifyFunction: function(fn, C) {
      var self = this;
      return function() {
        var instance = this;

        var args = Array.prototype.slice.call(arguments);
        var tx_params = {};
        var last_arg = args[args.length - 1];

        // It's only tx_params if it's an object and not a BigNumber.
        if (Utils.is_object(last_arg) && !Utils.is_big_number(last_arg)) {
          tx_params = args.pop();
        }

        tx_params = Utils.merge(C.class_defaults, tx_params);

        return new Promise(function(accept, reject) {
          var callback = function(error, result) {
            if (error != null) {
              reject(error);
            } else {
              accept(result);
            }
          };
          args.push(tx_params, callback);
          fn.apply(instance.contract, args);
        });
      };
    },
    synchronizeFunction: function(fn, C) {
      var self = this;
      return function() {
        var args = Array.prototype.slice.call(arguments);
        var tx_params = {};
        var last_arg = args[args.length - 1];

        // It's only tx_params if it's an object and not a BigNumber.
        if (Utils.is_object(last_arg) && !Utils.is_big_number(last_arg)) {
          tx_params = args.pop();
        }

        tx_params = Utils.merge(C.class_defaults, tx_params);

        return new Promise(function(accept, reject) {

          var callback = function(error, tx) {
            if (error != null) {
              reject(error);
              return;
            }

            var timeout = C.synchronization_timeout || 240000;
            var start = new Date().getTime();

            var make_attempt = function() {
              C.web3.eth.getTransactionReceipt(tx, function(err, receipt) {
                if (err) return reject(err);

                if (receipt != null) {
                  return accept(tx, receipt);
                }

                if (timeout > 0 && new Date().getTime() - start > timeout) {
                  return reject(new Error("Transaction " + tx + " wasn't processed in " + (timeout / 1000) + " seconds!"));
                }

                setTimeout(make_attempt, 1000);
              });
            };

            make_attempt();
          };

          args.push(tx_params, callback);
          fn.apply(self, args);
        });
      };
    }
  };

  function instantiate(instance, contract) {
    instance.contract = contract;
    var constructor = instance.constructor;

    // Provision our functions.
    for (var i = 0; i < instance.abi.length; i++) {
      var item = instance.abi[i];
      if (item.type == "function") {
        if (item.constant == true) {
          instance[item.name] = Utils.promisifyFunction(contract[item.name], constructor);
        } else {
          instance[item.name] = Utils.synchronizeFunction(contract[item.name], constructor);
        }

        instance[item.name].call = Utils.promisifyFunction(contract[item.name].call, constructor);
        instance[item.name].sendTransaction = Utils.promisifyFunction(contract[item.name].sendTransaction, constructor);
        instance[item.name].request = contract[item.name].request;
        instance[item.name].estimateGas = Utils.promisifyFunction(contract[item.name].estimateGas, constructor);
      }

      if (item.type == "event") {
        instance[item.name] = contract[item.name];
      }
    }

    instance.allEvents = contract.allEvents;
    instance.address = contract.address;
    instance.transactionHash = contract.transactionHash;
  };

  // Use inheritance to create a clone of this contract,
  // and copy over contract's static functions.
  function mutate(fn) {
    var temp = function Clone() { return fn.apply(this, arguments); };

    Object.keys(fn).forEach(function(key) {
      temp[key] = fn[key];
    });

    temp.prototype = Object.create(fn.prototype);
    bootstrap(temp);
    return temp;
  };

  function bootstrap(fn) {
    fn.web3 = new Web3();
    fn.class_defaults  = fn.prototype.defaults || {};

    // Set the network iniitally to make default data available and re-use code.
    // Then remove the saved network id so the network will be auto-detected on first use.
    fn.setNetwork("default");
    fn.network_id = null;
    return fn;
  };

  // Accepts a contract object created with web3.eth.contract.
  // Optionally, if called without `new`, accepts a network_id and will
  // create a new version of the contract abstraction with that network_id set.
  function Contract() {
    if (this instanceof Contract) {
      instantiate(this, arguments[0]);
    } else {
      var C = mutate(Contract);
      var network_id = arguments.length > 0 ? arguments[0] : "default";
      C.setNetwork(network_id);
      return C;
    }
  };

  Contract.currentProvider = null;

  Contract.setProvider = function(provider) {
    var wrapped = new Provider(provider);
    this.web3.setProvider(wrapped);
    this.currentProvider = provider;
  };

  Contract.new = function() {
    if (this.currentProvider == null) {
      throw new Error("RightsContract error: Please call setProvider() first before calling new().");
    }

    var args = Array.prototype.slice.call(arguments);

    if (!this.unlinked_binary) {
      throw new Error("RightsContract error: contract binary not set. Can't deploy new instance.");
    }

    var regex = /__[^_]+_+/g;
    var unlinked_libraries = this.binary.match(regex);

    if (unlinked_libraries != null) {
      unlinked_libraries = unlinked_libraries.map(function(name) {
        // Remove underscores
        return name.replace(/_/g, "");
      }).sort().filter(function(name, index, arr) {
        // Remove duplicates
        if (index + 1 >= arr.length) {
          return true;
        }

        return name != arr[index + 1];
      }).join(", ");

      throw new Error("RightsContract contains unresolved libraries. You must deploy and link the following libraries before you can deploy a new version of RightsContract: " + unlinked_libraries);
    }

    var self = this;

    return new Promise(function(accept, reject) {
      var contract_class = self.web3.eth.contract(self.abi);
      var tx_params = {};
      var last_arg = args[args.length - 1];

      // It's only tx_params if it's an object and not a BigNumber.
      if (Utils.is_object(last_arg) && !Utils.is_big_number(last_arg)) {
        tx_params = args.pop();
      }

      tx_params = Utils.merge(self.class_defaults, tx_params);

      if (tx_params.data == null) {
        tx_params.data = self.binary;
      }

      // web3 0.9.0 and above calls new twice this callback twice.
      // Why, I have no idea...
      var intermediary = function(err, web3_instance) {
        if (err != null) {
          reject(err);
          return;
        }

        if (err == null && web3_instance != null && web3_instance.address != null) {
          accept(new self(web3_instance));
        }
      };

      args.push(tx_params, intermediary);
      contract_class.new.apply(contract_class, args);
    });
  };

  Contract.at = function(address) {
    if (address == null || typeof address != "string" || address.length != 42) {
      throw new Error("Invalid address passed to RightsContract.at(): " + address);
    }

    var contract_class = this.web3.eth.contract(this.abi);
    var contract = contract_class.at(address);

    return new this(contract);
  };

  Contract.deployed = function() {
    if (!this.address) {
      throw new Error("Cannot find deployed address: RightsContract not deployed or address not set.");
    }

    return this.at(this.address);
  };

  Contract.defaults = function(class_defaults) {
    if (this.class_defaults == null) {
      this.class_defaults = {};
    }

    if (class_defaults == null) {
      class_defaults = {};
    }

    var self = this;
    Object.keys(class_defaults).forEach(function(key) {
      var value = class_defaults[key];
      self.class_defaults[key] = value;
    });

    return this.class_defaults;
  };

  Contract.extend = function() {
    var args = Array.prototype.slice.call(arguments);

    for (var i = 0; i < arguments.length; i++) {
      var object = arguments[i];
      var keys = Object.keys(object);
      for (var j = 0; j < keys.length; j++) {
        var key = keys[j];
        var value = object[key];
        this.prototype[key] = value;
      }
    }
  };

  Contract.all_networks = {
  "default": {
    "abi": [
      {
        "constant": false,
        "inputs": [],
        "name": "claimDisputed",
        "outputs": [],
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [
          {
            "name": "_addr",
            "type": "address"
          },
          {
            "name": "_name",
            "type": "string"
          },
          {
            "name": "_role",
            "type": "string"
          },
          {
            "name": "_rightsSplit",
            "type": "uint256"
          }
        ],
        "name": "makeParty",
        "outputs": [],
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [],
        "name": "getBalance",
        "outputs": [
          {
            "name": "retVal",
            "type": "uint256"
          }
        ],
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [],
        "name": "checkSplit",
        "outputs": [
          {
            "name": "retVal",
            "type": "bool"
          }
        ],
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [
          {
            "name": "_from",
            "type": "string"
          },
          {
            "name": "_purpose",
            "type": "string"
          }
        ],
        "name": "sendPayment",
        "outputs": [],
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [],
        "name": "reinstateContract",
        "outputs": [],
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [
          {
            "name": "i",
            "type": "uint256"
          }
        ],
        "name": "getPartyAccept",
        "outputs": [
          {
            "name": "_accepts",
            "type": "bool"
          }
        ],
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [
          {
            "name": "",
            "type": "address"
          }
        ],
        "name": "proposals",
        "outputs": [
          {
            "name": "",
            "type": "string"
          }
        ],
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [
          {
            "name": "i",
            "type": "uint256"
          }
        ],
        "name": "getPartyName",
        "outputs": [
          {
            "name": "_name",
            "type": "string"
          }
        ],
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [
          {
            "name": "i",
            "type": "uint256"
          }
        ],
        "name": "getPartyRole",
        "outputs": [
          {
            "name": "_role",
            "type": "string"
          }
        ],
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [
          {
            "name": "_proposal",
            "type": "string"
          }
        ],
        "name": "createProposal",
        "outputs": [],
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [],
        "name": "withdrawBalance",
        "outputs": [],
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [
          {
            "name": "",
            "type": "address"
          }
        ],
        "name": "Permission",
        "outputs": [
          {
            "name": "",
            "type": "bool"
          }
        ],
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [
          {
            "name": "addr",
            "type": "address"
          }
        ],
        "name": "vote",
        "outputs": [],
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [],
        "name": "unlockPayments",
        "outputs": [],
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [],
        "name": "checkVotes",
        "outputs": [
          {
            "name": "retVal",
            "type": "uint256"
          }
        ],
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [
          {
            "name": "i",
            "type": "uint256"
          }
        ],
        "name": "getPartyVote",
        "outputs": [
          {
            "name": "_vote",
            "type": "address"
          }
        ],
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [
          {
            "name": "i",
            "type": "uint256"
          }
        ],
        "name": "getPartySplit",
        "outputs": [
          {
            "name": "_split",
            "type": "uint256"
          }
        ],
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [],
        "name": "acceptTerms",
        "outputs": [],
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [
          {
            "name": "addr",
            "type": "address"
          }
        ],
        "name": "getPermission",
        "outputs": [
          {
            "name": "retVal",
            "type": "bool"
          }
        ],
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [],
        "name": "setMetaHash",
        "outputs": [],
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [
          {
            "name": "i",
            "type": "uint256"
          }
        ],
        "name": "getAddrs",
        "outputs": [
          {
            "name": "retVal",
            "type": "address"
          }
        ],
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [],
        "name": "getPaymentsUnlocked",
        "outputs": [
          {
            "name": "retVal",
            "type": "bool"
          }
        ],
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [
          {
            "name": "addr",
            "type": "address"
          }
        ],
        "name": "setPermission",
        "outputs": [],
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [],
        "name": "stage",
        "outputs": [
          {
            "name": "",
            "type": "uint8"
          }
        ],
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [
          {
            "name": "_addr",
            "type": "address"
          }
        ],
        "name": "removeParty",
        "outputs": [],
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [],
        "name": "getNumberPartyAddresses",
        "outputs": [
          {
            "name": "retVal",
            "type": "uint256"
          }
        ],
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [],
        "name": "getHash",
        "outputs": [
          {
            "name": "retVal",
            "type": "string"
          }
        ],
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [
          {
            "name": "",
            "type": "address"
          }
        ],
        "name": "votes",
        "outputs": [
          {
            "name": "",
            "type": "address"
          }
        ],
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [
          {
            "name": "i",
            "type": "uint256"
          }
        ],
        "name": "getPartyProposal",
        "outputs": [
          {
            "name": "_proposal",
            "type": "string"
          }
        ],
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [],
        "name": "getStage",
        "outputs": [
          {
            "name": "retVal",
            "type": "uint256"
          }
        ],
        "type": "function"
      },
      {
        "inputs": [],
        "type": "constructor"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": true,
            "name": "sender",
            "type": "address"
          },
          {
            "indexed": true,
            "name": "from",
            "type": "string"
          },
          {
            "indexed": true,
            "name": "purpose",
            "type": "string"
          }
        ],
        "name": "Payment",
        "type": "event"
      }
    ],
    "unlinked_binary": "0x60606040526000805460ff19168155600381905560045561182a806100246000396000f3606060405236156101695760e060020a6000350463058f2270811461016b57806310953b45146101c257806312065fe0146102bf578063170e944e146102df578063221c94b61461033b5780632607ab20146103d85780632f370e47146104235780633341b4451461047457806338b4730e146104e257806342a403e01461058957806349c2a1a6146106315780635fd8c7101461074f5780636811d3d9146107ac5780636dd7d8ea146107c75780636e2123ee1461080b578063730bd9291461085a5780637381389c146108cf5780637e0b495014610921578063815af9081461097057806383c1cd8a146109a8578063898ac3fe146109d05780639c57c18714610a1a578063a783474014610a54578063b85a35d214610a62578063c040e6b814610a77578063c1a4224314610a83578063c522debd14610b0e578063d13319c414610b19578063d8bff5a514610b83578063e5afffed14610ba4578063fcaa766414610c4a575b005b61016933600160a060020a031660009081526001602052604090205460ff1615610d2957600c5462093a80014210806101a9575060005460ff166003145b806101b857506000805460ff16145b15610d0957610002565b60408051602060248035600481810135601f81018590048502860185019096528585526101699581359591946044949293909201918190840183828082843750506040805160209735808a0135601f81018a90048a0283018a01909352828252969897606497919650602491909101945090925082915084018382808284375094965050933593505050506040805160a0810182526000608082018181528252825160208181018552828252838101919091528284018290526060830182905233600160a060020a0316825260019052919091205460ff1615610fa9576000805460ff161415610fa95760055460649083011115610d2b57610002565b610c5833600160a060020a03166000908152600860205260409020545b90565b610c6a5b600080805b600354811015610fb057600280546007916000918490811015610002575060008051602061180a833981519152840154600160a060020a03168252602092909252604090200154909101906001016102e8565b6040805160206004803580820135601f8101849004840285018401909552848452610169949193602493909291840191908190840183828082843750506040805160208835808b0135601f8101839004830284018301909452838352979998604498929750919091019450909250829150840183828082843750949650505050505050600b5460009081908190819060ff161515610fd757610002565b61016933600160a060020a031660009081526001602052604081205460ff161561112757805460ff1660031415611127576007602052604081206003015460ff16156110f657610002565b610c6a60043560006007600050600060026000508481548110156100025750505060008051602061180a833981519152830154600160a060020a03168252602052604090206003015460ff166109cb565b610c7e6004356009602090815260009182526040918290208054835160026001831615610100026000190190921691909104601f81018490048402820184019094528381529290918301828280156111555780601f1061112a57610100808354040283529160200191611155565b610c7e600435604080516020810190915260008082526002805460079291908590811015610002575060008051602061180a833981519152850154600160a060020a031682526020928352604091829020805483516001821615610100026000190190911692909204601f810185900485028301850190935282825290929091908301828280156111885780601f1061115d57610100808354040283529160200191611188565b610c7e600435604080516020810190915260008082526002805460079291908590811015610002575060008051602061180a833981519152850154600160a060020a0316825260209283526040918290206001908101805484519281161561010002600019011692909204601f8101859004850282018501909352828152929091908301828280156111885780601f1061115d57610100808354040283529160200191611188565b6040805160206004803580820135601f810184900484028501840190955284845261016994919360249390929184019190819084018382808284375094965050505050505033600160a060020a031660009081526001602052604081205460ff1615611197575b60035481101561119b5733600160a060020a0316600a60005060006002600050848154811015610002576000918252602080832090910154600160a060020a039081168452908301939093526040919091019020541614156107475760028054600a916000918490811015610002579060005260206000209001600090546101009190910a9004600160a060020a0316815260208101919091526040016000208054600160a060020a03191690555b600101610698565b61016933600160a060020a031660009081526001602052604081205460ff161561112757600860205260408082208054908390559051909133600160a060020a031691839082818181858883f19350505050151561112757610002565b610c6a60043560016020526000908152604090205460ff1681565b61016960043533600160a060020a031660009081526001602052604090205460ff161561112757600a60205260406000208054600160a060020a0319168217905550565b6101695b33600160a060020a031660009081526001602052604090205460ff1615610d295760005460ff1660011415610d295760005460ff16600314610d295760055460641461123657610002565b610c585b60008080808080805b6003548310156112455760028054600a916000918690811015610002576000918252602080832090910154600160a060020a03908116845283820194909452604092830182205490931680825292899052208054600190810190915593909301929150610867565b610cec6004356000600a600050600060026000508481548110156100025750505060008051602061180a833981519152830154600160a060020a039081168352602091909152604090912054166109cb565b610c586004356000600760005060006002600050848154811015610002575060008051602061180a833981519152850154600160a060020a0316909152602091909152604090912001546109cb565b61016933600160a060020a031660009081526001602052604081205460ff161561112757805460ff16811415611127576113086102e3565b610c6a600435600160a060020a03811660009081526001602052604090205460ff165b919050565b61016933600160a060020a0316600090815260016020526040812054819060ff161561119757805460ff16600214801590610a105750805460ff16600114155b1561139457610002565b610cec600435600060026000508281548110156100025750905260008051602061180a833981519152810154600160a060020a03166109cb565b610c6a600b5460ff166102dc565b61016960043560035460001461150457610002565b610c5860005460ff1681565b6101696004356000610c80604051908101604052806064905b6000815260200190600190039081610a9c57505033600160a060020a031660009081526001602052604081205481908190819060ff16156117ca57805460ff168114156117ca57600160a060020a0387168152604081205460ff161580610b04575060035481145b1561152b57610002565b610c586003546102dc565b60408051602081810183526000825282516006805460026001821615610100026000190190911604601f8101849004840283018401909552848252610c7e9491929091908301828280156117fe5780601f106117d3576101008083540402835291602001916117fe565b610cec600435600a60205260009081526040902054600160a060020a031681565b610c7e600435604080516020810190915260008082526002805460099291908590811015610002576000918252602080832090910154600160a060020a0316835282810193909352604091820190208054825160026001831615610100026000190190921691909104601f8101859004850282018501909352828152929091908301828280156111885780601f1061115d57610100808354040283529160200191611188565b610c5860005460ff166102dc565b60408051918252519081900360200190f35b604080519115158252519081900360200190f35b60405180806020018281038252838181518152602001915080519060200190808383829060006004602084601f0104600302600f01f150905090810190601f168015610cde5780820380516001836020036101000a031916815260200191505b509250505060405180910390f35b60408051600160a060020a03929092168252519081900360200190f35b6000805460ff199081166003178255600b8054909116905560045542600c555b565b50604080516080810182528481526020818101859052818301849052600060608301819052600160a060020a03881681526007825292832082518051825483875295849020949586959394859460026001841615610100026000190190931692909204601f90810182900483019490910190839010610dcd57805160ff19168380011785555b50610dfd9291505b80821115610e5c5760008155600101610db9565b82800160010185558215610db1579182015b82811115610db1578251826000505591602001919060010190610ddf565b50506020820151816001016000509080519060200190828054600181600116156101000203166002900490600052602060002090601f016020900481019282601f10610e6057805160ff19168380011785555b50610e90929150610db9565b5090565b82800160010185558215610e50579182015b82811115610e50578251826000505591602001919060010190610e72565b505060408281015160028381019190915560039290920180546060949094015160ff19948516179055600160a060020a0388166000908152600160208190529190208054909316811790925580549182018082559091908281838015829011610f0c57818360005260206000209182019101610f0c9190610db9565b50505060009283525060208220018054600160a060020a03191687179055600580548401905560038054600101905560045414610fa957610fa95b60005b6003548110156111275760006007600050600060026000508481548110156100025750505060008051602061180a833981519152830154600160a060020a0316825260205260408120600301805460ff19169055600455600101610f4a565b5050505050565b8160641480610fbf5750816000145b15610fcd5760019250610fd2565b600092505b505090565b349350600092505b60035483101561104f57600280548490811015610002575060008051602061180a833981519152840154600160a060020a03166000818152600760209081526040808320909401546008909152929020805460649388029390930492830190556001949094019392509050610fdf565b84604051808280519060200190808383829060006004602084601f0104600302600f01f150905001915050604051809103902086604051808280519060200190808383829060006004602084601f0104600302600f01f150905001915050604051809103902033600160a060020a03167ffc71ca374d789cccc9fb9258741cd962692a685bbb38110ecaec13732506fe9760405180905060405180910390a4505050505050565b506004805460010190819055600354600290049081901115611127576000805460ff19168155600455611127610f47565b50565b820191906000526020600020905b81548152906001019060200180831161113857829003601f168201915b505050505081565b820191906000526020600020905b81548152906001019060200180831161116b57829003601f168201915b505050505090506109cb565b50505b5050565b33600160a060020a0316600090815260096020908152604082208451815482855293839020919360026001821615610100026000190190911604601f90810184900483019391929187019083901061120657805160ff19168380011785555b50611194929150610db9565b828001600101855582156111fa579182015b828111156111fa578251826000505591602001919060010190611218565b600b805460ff19166001179055565b5060005b6003548110156112e457838660006002600050848154811015610002576000918252602080832090910154600160a060020a0316835282019290925260400190205411156112dc578560006002600050838154811015610002579060005260206000209001600090546101009190910a9004600160a060020a031681526020810191909152604001600020549094509250835b600101611249565b600354600290048411156112fa578496506112ff565b606596505b50505050505090565b158061132f575033600160a060020a031660009081526007602052604090206003015460ff165b1561133957610002565b506004805460018181019092556003805433600160a060020a03166000908152600760205260408120909201805460ff191690941790935591036000190190811415611127576000805460ff1916600117905561112761080f565b61139c61085e565b915081606514156113ac57610002565b6002805460099160009185908110156100025750815260008051602061180a8339815191528401819054906101000a9004600160a060020a0316600160a060020a0316815260200190815260200160002060005060066000509080546001816001161561010002031660029004828054600181600116156101000203166002900490600052602060002090601f016020900481019282601f1061145a57805485555b50611496929150610db9565b8280016001018555821561144e57600052602060002091601f016020900482015b8281111561144e57825482559160010191906001019061147b565b50506000805460ff1916600217815590505b6003548110156111975760028054600a91600091849081101561000257505060008051602061180a833981519152830154600160a060020a03168152602091909152604090208054600160a060020a03191690556001016114a8565b600160a060020a03166000908152600160208190526040909120805460ff19169091179055565b600354600160a060020a0388166000908152600160208181526040808420805460ff191690556007909152822080548382556000199485019a50909384926002908316156101000290910190911604601f81901061165b57505b5060018201600050805460018160011615610100020316600290046000825580601f1061167957505b5050600060028201819055600391909101805460ff1916905592505b60035483101561169d5786600160a060020a03166002600050848154811015610002575060005260008051602061180a833981519152840154600160a060020a0316146116975760028054849081101561000257505060008051602061180a833981519152830154600160a060020a03168584606481101561000257505060208402860152600192909201916115ca565b601f0160209004906000526020600020908101906115859190610db9565b601f0160209004906000526020600020908101906115ae9190610db9565b82935083505b8391505b8582101561170a5760028054600184019081101561000257506000527f405787fa12a823e0f2b7631cc41b3ba8828b3321ca811111fa75cd3aa3bb5acf820154600160a060020a03168583606481101561000257505060208302860152600191909101906116a1565b600280546000808355919091526117339060008051602061180a83398151915290810190610db9565b50600090505b8581101561176f576002805460018101808355828183801582901161178b5760008381526020902061178b918101908301610db9565b600380546000190190556004546000146117ca576117ca610f47565b5050509190906000526020600020900160008784606481101561000257505050602083028701518154600160a060020a03191617905550600101611739565b50505050505050565b820191906000526020600020905b8154815290600101906020018083116117e157829003601f168201915b505050505090506102dc56405787fa12a823e0f2b7631cc41b3ba8828b3321ca811111fa75cd3aa3bb5ace",
    "updated_at": 1472752550232,
    "links": {},
    "address": "0xe2e6bc6a5ee6fab6355445ce7a4587bb150472dd"
  }
};

  Contract.checkNetwork = function(callback) {
    var self = this;

    if (this.network_id != null) {
      return callback();
    }

    this.web3.version.network(function(err, result) {
      if (err) return callback(err);

      var network_id = result.toString();

      // If we have the main network,
      if (network_id == "1") {
        var possible_ids = ["1", "live", "default"];

        for (var i = 0; i < possible_ids.length; i++) {
          var id = possible_ids[i];
          if (Contract.all_networks[id] != null) {
            network_id = id;
            break;
          }
        }
      }

      if (self.all_networks[network_id] == null) {
        return callback(new Error(self.name + " error: Can't find artifacts for network id '" + network_id + "'"));
      }

      self.setNetwork(network_id);
      callback();
    })
  };

  Contract.setNetwork = function(network_id) {
    var network = this.all_networks[network_id] || {};

    this.abi             = this.prototype.abi             = network.abi;
    this.unlinked_binary = this.prototype.unlinked_binary = network.unlinked_binary;
    this.address         = this.prototype.address         = network.address;
    this.updated_at      = this.prototype.updated_at      = network.updated_at;
    this.links           = this.prototype.links           = network.links || {};

    this.network_id = network_id;
  };

  Contract.networks = function() {
    return Object.keys(this.all_networks);
  };

  Contract.link = function(name, address) {
    if (typeof name == "object") {
      Object.keys(name).forEach(function(n) {
        var a = name[n];
        Contract.link(n, a);
      });
      return;
    }

    Contract.links[name] = address;
  };

  Contract.contract_name   = Contract.prototype.contract_name   = "RightsContract";
  Contract.generated_with  = Contract.prototype.generated_with  = "3.1.2";

  var properties = {
    binary: function() {
      var binary = Contract.unlinked_binary;

      Object.keys(Contract.links).forEach(function(library_name) {
        var library_address = Contract.links[library_name];
        var regex = new RegExp("__" + library_name + "_*", "g");

        binary = binary.replace(regex, library_address.replace("0x", ""));
      });

      return binary;
    }
  };

  Object.keys(properties).forEach(function(key) {
    var getter = properties[key];

    var definition = {};
    definition.enumerable = true;
    definition.configurable = false;
    definition.get = getter;

    Object.defineProperty(Contract, key, definition);
    Object.defineProperty(Contract.prototype, key, definition);
  });

  bootstrap(Contract);

  if (typeof module != "undefined" && typeof module.exports != "undefined") {
    module.exports = Contract;
  } else {
    // There will only be one version of this contract in the browser,
    // and we can use that.
    window.RightsContract = Contract;
  }
})();
